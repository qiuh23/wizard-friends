#!/usr/bin/env python3
"""Offline security archive, restore and disk checks. No cloud calls or secrets.

Security event archives are incremental, immutable gzip JSON. Moderation state is
small and saved as a separate latest snapshot. Never copy the long audit DB into
the rotating daily rooms backup. Run with the application's writes quiesced for
restore; backup uses a consistent SQLite read transaction while it is running.
"""
import argparse
import calendar
from contextlib import contextmanager
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import time
import urllib.request

EVENT_COLUMNS = ('id', 'at', 'expires_at', 'held', 'event')
STATE_COLUMNS = {
    'moderation': ('room_code', 'kind', 'target', 'at', 'expires_at', 'event_id'),
    'security_moderation': ('room', 'state', 'expires_at', 'held'),
    'security_evidence': ('id', 'room_code', 'at', 'expires_at', 'held', 'evidence'),
}


@contextmanager
def database_connection(path, readonly=False):
    db = sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True, timeout=15) if readonly else sqlite3.connect(path, timeout=15)
    try:
        with db:
            yield db
    finally:
        db.close()


def connect(path):
    return database_connection(path, readonly=True)


def columns(db, table):
    return tuple(row[1] for row in db.execute('PRAGMA table_info("' + table + '")'))


def checked_events(db):
    if set(columns(db, 'security_events')) != set(EVENT_COLUMNS):
        raise ValueError('Unexpected audit schema; review migration before archival.')


def atomic(path, data):
    path = Path(path)
    temporary = path.with_name(path.name + '.next')
    with open(temporary, 'xb') as out:
        os.chmod(temporary, 0o600)
        out.write(data)
        out.flush()
        os.fsync(out.fileno())
    os.replace(temporary, path)
    # Durably publish the directory entry before advancing any cursor.
    if os.name != 'nt':
        fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def pack(path, value):
    raw = gzip.compress(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8'), mtime=0)
    atomic(path, raw)
    atomic(str(path) + '.sha256', (hashlib.sha256(raw).hexdigest() + '\n').encode('ascii'))


def unpack(path):
    raw = Path(path).read_bytes()
    expected = Path(str(path) + '.sha256').read_text('ascii').strip()
    if hashlib.sha256(raw).hexdigest() != expected:
        raise ValueError('Archive checksum mismatch: ' + Path(path).name)
    value = json.loads(gzip.decompress(raw))
    if value.get('version') != 1:
        raise ValueError('Unsupported archive version.')
    return value


def archive_manifest(dest, previous=None):
    entries = []
    known = {entry['name']: entry for entry in previous or []}
    for path in sorted(dest.glob('events-*.json.gz')):
        if path.name in known:
            entries.append(known[path.name])
            continue
        value = unpack(path)
        rows = value['rows']
        entries.append({'name': path.name, 'sha256': Path(str(path) + '.sha256').read_text('ascii').strip(),
                        'minId': rows[0][0], 'maxId': rows[-1][0], 'maxExpiry': max(row[2] for row in rows), 'bytes': path.stat().st_size})
    return entries


def required_segments(dest, snapshot, deep=False):
    if 'segments' not in snapshot:
        raise ValueError('Missing required segment manifest; rerun reviewed migration.')
    expected = {entry['name']: entry for entry in snapshot['segments']}
    for name, entry in expected.items():
        path = dest / name
        if Path(name).name != name or not name.startswith('events-') or not path.is_file():
            raise ValueError('Required audit segment is missing: ' + name)
        if Path(str(path) + '.sha256').read_text('ascii').strip() != entry['sha256']:
            raise ValueError('Required audit segment differs from the snapshot manifest.')
        if path.stat().st_size != entry['bytes']:
            raise ValueError('Required audit segment size differs from the snapshot manifest.')
        if deep:
            unpack(path)
    return expected


def preflight(database, minimum=2 * 1024**3, percent=10, health_url=None, allow_missing=False, space=None):
    path = Path(database)
    anchor = path.parent
    while not anchor.exists():
        anchor = anchor.parent
    usage = (space or shutil.disk_usage)(anchor)
    required = max(minimum, int(usage.total * percent / 100))
    if usage.free < required:
        raise ValueError(f'SECURITY STORAGE ALERT: free={usage.free} required={required}; new release refused; retained records untouched.')
    if hasattr(os, 'statvfs'):
        inode = os.statvfs(anchor)
        if inode.f_files and inode.f_favail / inode.f_files < 0.05:
            raise ValueError('SECURITY STORAGE ALERT: fewer than 5% free inodes; new release refused.')
    if path.exists():
        with connect(path) as db:
            checked_events(db)
            if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise ValueError('SECURITY STORAGE ALERT: audit database integrity check failed.')
    elif not allow_missing:
        raise ValueError('Required audit database is absent; finish the reviewed first-run migration before publication.')
    if health_url:
        with urllib.request.urlopen(health_url, timeout=5) as response:
            health = json.load(response)
        if health.get('ok') is not True:
            raise ValueError('SECURITY STORAGE ALERT: application audit readiness failed; new release refused.')
    return {'freeBytes': usage.free, 'requiredFreeBytes': required, 'auditExists': path.exists()}


def backup(database, destination, batch=5000, now=None):
    now = int(time.time() * 1000) if now is None else now
    dest = Path(destination)
    dest.mkdir(parents=True, exist_ok=True, mode=0o700)
    if dest.is_symlink():
        raise ValueError('Archive directory must not be a symbolic link.')
    os.chmod(dest, 0o700)
    cursor_path = dest / 'cursor.json'
    cursor = json.loads(cursor_path.read_text('utf-8'))['lastId'] if cursor_path.exists() else 0
    previous_segments = []
    if (dest / 'state-latest.json.gz').exists():
        previous_snapshot = unpack(dest / 'state-latest.json.gz')
        required_segments(dest, previous_snapshot)
        previous_segments = previous_snapshot['segments']
    count = 0
    with connect(database) as db:
        db.execute('BEGIN')
        checked_events(db)
        highest = db.execute('SELECT COALESCE(MAX(id),0) FROM security_events').fetchone()[0]
        sequence = db.execute("SELECT seq FROM sqlite_sequence WHERE name='security_events'").fetchone()
        if cursor > max(highest, sequence[0] if sequence else 0):
            raise ValueError('Audit IDs moved backwards; use a new archive directory after recovery.')
        while True:
            rows = list(db.execute('SELECT id,at,expires_at,held,event FROM security_events WHERE id>? ORDER BY id LIMIT ?', (cursor, batch)))
            if not rows:
                break
            # Separate retention policies and expiry UTC days. Short admin/content
            # evidence must not inherit a six-month network segment's life.
            buckets = {}
            for row in rows:
                policy = 'long' if row[2] - row[1] >= 120 * 86400000 else 'short'
                buckets.setdefault((policy, row[2] // 86400000), []).append(row)
            for group in buckets.values():
                target = dest / f'events-{group[0][0]:020d}-{group[-1][0]:020d}.json.gz'
                value = {'version': 1, 'type': 'events', 'rows': group}
                if target.exists():
                    if unpack(target) != json.loads(json.dumps(value)):
                        raise ValueError('Existing archive differs; do not overwrite retained evidence.')
                else:
                    pack(target, value)
            cursor = rows[-1][0]
            atomic(cursor_path, json.dumps({'version': 1, 'lastId': cursor}).encode('utf-8'))
            count += len(rows)
        states = {}
        for table, allowed in STATE_COLUMNS.items():
            actual = columns(db, table)
            if actual:
                if actual != allowed:
                    raise ValueError('Unexpected moderation schema: ' + table)
                states[table] = list(db.execute('SELECT * FROM "' + table + '"'))
        # Replacing only the latest small snapshot avoids multiplying tombstones
        # every day. Copy archive+snapshot to encrypted off-instance storage.
        held_ids = [row[0] for row in db.execute('SELECT id FROM security_events WHERE held<>0 ORDER BY id')]
        if not cursor_path.exists():
            atomic(cursor_path, json.dumps({'version': 1, 'lastId': cursor}).encode('utf-8'))
        pack(dest / 'state-latest.json.gz', {'version': 1, 'type': 'state', 'at': now, 'tables': states, 'lastId': cursor, 'heldIds': held_ids, 'segments': archive_manifest(dest, previous_segments)})
    return {'archivedEvents': count, 'lastId': cursor}


def cleanup(database, destination, now=None, limit=20):
    now = int(time.time() * 1000) if now is None else now
    dest = Path(destination)
    if (dest / 'HOLD').exists():
        return {'deletedSegments': 0, 'hold': True}
    removed = 0
    snapshot_path = dest / 'state-latest.json.gz'
    snapshot = unpack(snapshot_path)
    cursor = json.loads((dest / 'cursor.json').read_text('utf-8'))['lastId']
    if cursor != snapshot['lastId']:
        raise ValueError('Incomplete backup; rerun backup before cleanup.')
    required_segments(dest, snapshot)
    entries = {entry['name']: entry for entry in snapshot['segments']}
    with connect(database) as db:
        checked_events(db)
        for path in sorted(dest.glob('events-*.json.gz')):
            if path.name in entries and entries[path.name]['maxExpiry'] > now:
                continue
            value = unpack(path)
            rows = value['rows']
            # Never trust age/size alone. A later hold in the live DB wins over
            # an older backup; a backup hold without proof of release is kept.
            eligible = True
            for row in rows:
                live = db.execute('SELECT expires_at,held FROM security_events WHERE id=?', (row[0],)).fetchone()
                if row[2] > now or (live and (live[0] > now or live[1])) or (row[3] and (not live or live[1])):
                    eligible = False
                    break
            if eligible:
                # Publish the manifest without this fully expired segment before
                # unlink. A crash can leave an extra expired file, never a missing
                # required segment. Restore verifies extras are expired and clear.
                snapshot['segments'] = [item for item in snapshot['segments'] if item['name'] != path.name]
                pack(snapshot_path, snapshot)
                path.unlink()
                Path(str(path) + '.sha256').unlink()
                removed += 1
                if removed >= limit:
                    break
    return {'deletedSegments': removed}


def restore(destination, target, now=None):
    now = int(time.time() * 1000) if now is None else now
    target = Path(target)
    if target.exists() or target.is_symlink():
        raise ValueError('Restore target must be a new, absent path. Never overwrite an active database.')
    dest = Path(destination)
    snapshot = unpack(dest / 'state-latest.json.gz')
    if snapshot.get('type') != 'state':
        raise ValueError('Missing verified moderation snapshot.')
    cursor = json.loads((dest / 'cursor.json').read_text('utf-8'))['lastId']
    if cursor != snapshot['lastId']:
        raise ValueError('Backup is incomplete; cursor and verified snapshot differ.')
    expected = required_segments(dest, snapshot, deep=True)
    current_holds = set(snapshot.get('heldIds', []))
    for extra in dest.glob('events-*.json.gz'):
        if extra.name not in expected:
            rows = unpack(extra)['rows']
            if any(row[0] > cursor or row[2] > now or row[0] in current_holds for row in rows):
                raise ValueError('Unlisted unexpired audit segment; backup may be incomplete.')
    stage = target.with_name(target.name + '.restore-next')
    if stage.exists():
        raise ValueError('Restore staging file already exists; inspect it first.')
    try:
        with database_connection(stage) as db:
            os.chmod(stage, 0o600)
            db.execute('CREATE TABLE security_events(id INTEGER PRIMARY KEY AUTOINCREMENT,at INTEGER NOT NULL,expires_at INTEGER NOT NULL,held INTEGER NOT NULL DEFAULT 0,event TEXT NOT NULL)')
            highest = snapshot.get('lastId', 0)
            snapshot_highest = highest
            held_ids = set(snapshot.get('heldIds', []))
            seen_held = set()
            count = 0
            for path in [dest / name for name in sorted(expected)]:
                value = unpack(path)
                if value.get('type') != 'events':
                    raise ValueError('Invalid event segment.')
                for row in value['rows']:
                    if len(row) != 5:
                        raise ValueError('Invalid event row.')
                    highest = max(highest, row[0])
                    # Holds may have changed after an immutable event segment.
                    # The latest complete snapshot carries the current holds.
                    if row[0] <= snapshot_highest:
                        row[3] = int(row[0] in held_ids)
                    if row[0] in held_ids:
                        seen_held.add(row[0])
                    if row[2] > now or row[3]:
                        db.execute('INSERT INTO security_events(id,at,expires_at,held,event) VALUES(?,?,?,?,?)', row)
                        count += 1
            for table, rows in snapshot['tables'].items():
                if table not in STATE_COLUMNS:
                    raise ValueError('Unexpected state table.')
                if table == 'moderation':
                    db.execute('CREATE TABLE moderation(room_code TEXT NOT NULL,kind TEXT NOT NULL,target TEXT NOT NULL,at INTEGER NOT NULL,expires_at INTEGER NOT NULL,event_id INTEGER,PRIMARY KEY(room_code,kind,target))')
                elif table == 'security_moderation':
                    db.execute('CREATE TABLE security_moderation(room TEXT PRIMARY KEY,state TEXT NOT NULL,expires_at INTEGER NOT NULL,held INTEGER NOT NULL DEFAULT 0)')
                    # Closed-room and hide marks remain until normal runtime
                    # room lifetime expires, and remain under a room/event hold.
                elif table == 'security_evidence':
                    db.execute('CREATE TABLE security_evidence(id INTEGER PRIMARY KEY,room_code TEXT NOT NULL,at INTEGER NOT NULL,expires_at INTEGER NOT NULL,held INTEGER NOT NULL DEFAULT 0,evidence TEXT NOT NULL)')
                    rows = [row for row in rows if row[3] > now or row[4]]
                marks = ','.join('?' for _ in STATE_COLUMNS[table])
                db.executemany('INSERT INTO "' + table + '" VALUES(' + marks + ')', rows)
            if seen_held != held_ids:
                raise ValueError('A held record is absent from required audit segments.')
            db.execute("DELETE FROM sqlite_sequence WHERE name='security_events'")
            db.execute("INSERT INTO sqlite_sequence(name,seq) VALUES('security_events',?)", (highest,))
            db.execute('CREATE INDEX security_expiry ON security_events(held,expires_at,id)')
            if 'security_moderation' in snapshot['tables']:
                # Wizard's usage counter is derived, never imported stale. Build
                # it from restored rows and install the current runtime triggers.
                db.execute('CREATE TABLE security_usage(id INTEGER PRIMARY KEY CHECK(id=1),bytes INTEGER NOT NULL)')
                events_bytes = db.execute('SELECT COALESCE(SUM(length(CAST(event AS BLOB))+256),0) FROM security_events').fetchone()[0]
                state_bytes = db.execute('SELECT COALESCE(SUM(length(CAST(state AS BLOB))+256),0) FROM security_moderation').fetchone()[0]
                db.execute('INSERT INTO security_usage VALUES(1,?)', (events_bytes + state_bytes,))
                db.executescript('''CREATE TRIGGER security_event_insert AFTER INSERT ON security_events BEGIN UPDATE security_usage SET bytes=bytes+length(CAST(NEW.event AS BLOB))+256 WHERE id=1; END;
                CREATE TRIGGER security_event_delete AFTER DELETE ON security_events BEGIN UPDATE security_usage SET bytes=bytes-length(CAST(OLD.event AS BLOB))-256 WHERE id=1; END;
                CREATE TRIGGER security_moderation_insert AFTER INSERT ON security_moderation BEGIN UPDATE security_usage SET bytes=bytes+length(CAST(NEW.state AS BLOB))+256 WHERE id=1; END;
                CREATE TRIGGER security_moderation_update AFTER UPDATE OF state ON security_moderation BEGIN UPDATE security_usage SET bytes=bytes+length(CAST(NEW.state AS BLOB))-length(CAST(OLD.state AS BLOB)) WHERE id=1; END;
                CREATE TRIGGER security_moderation_delete AFTER DELETE ON security_moderation BEGIN UPDATE security_usage SET bytes=bytes-length(CAST(OLD.state AS BLOB))-256 WHERE id=1; END;''')
            if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise ValueError('Restored database failed integrity check.')
        os.replace(stage, target)
    except BaseException:
        if stage.exists():
            stage.unlink()
        raise
    return {'restoredEvents': count, 'lastId': highest, 'target': str(target)}


def six_months_after(seconds):
    value = time.gmtime(seconds)
    month = value.tm_mon + 6
    year = value.tm_year + (month - 1) // 12
    month = (month - 1) % 12 + 1
    day = min(value.tm_mday, calendar.monthrange(year, month)[1])
    return calendar.timegm((year, month, day, value.tm_hour, value.tm_min, value.tm_sec))


def cleanup_network(directory, now=None, limit=20):
    """Only reviewed dateext files; six calendar months after closed-file mtime.
    HOLD keeps all closed files. A .hold sibling keeps one file. No active files.
    """
    now = time.time() if now is None else now
    directory = Path(directory)
    if (directory / 'HOLD').exists():
        return {'deletedNetworkLogs': 0, 'hold': True}
    deleted = 0
    import re
    for path in sorted(directory.glob('*.log-*.gz')):
        if not re.fullmatch(r'(athlete-production|athlete-preview|wizard)\.log-\d{8}T\d{6}\.gz', path.name):
            continue
        if path.is_symlink() or Path(str(path) + '.hold').exists():
            continue
        if six_months_after(path.stat().st_mtime) <= now:
            path.unlink()
            deleted += 1
            if deleted >= limit:
                break
    return {'deletedNetworkLogs': deleted}


def rollback_check(database):
    path = Path(database)
    if not path.exists():
        return {'legacyRollbackSafe': True}
    with connect(path) as db:
        checked_events(db)
        for table in ('security_events', 'moderation', 'security_moderation', 'security_evidence'):
            if columns(db, table) and db.execute('SELECT 1 FROM "' + table + '" LIMIT 1').fetchone():
                raise ValueError('Legacy rollback refused: existing audit/disposition state requires the security-aware version. Keep maintenance pause and fix forward.')
    return {'legacyRollbackSafe': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('preflight', 'backup', 'cleanup', 'restore', 'cleanup-network', 'rollback-check'))
    parser.add_argument('--database')
    parser.add_argument('--archive-dir')
    parser.add_argument('--restore-to')
    parser.add_argument('--network-dir', default='/var/log/game-network')
    parser.add_argument('--min-free-bytes', type=int, default=2 * 1024**3)
    parser.add_argument('--warn-free-percent', type=float, default=10)
    parser.add_argument('--batch', type=int, default=5000)
    parser.add_argument('--health-url')
    parser.add_argument('--allow-uninitialized', action='store_true')
    parser.add_argument('--config', help='Optional root-managed nonsecret JSON capacity settings')
    args = parser.parse_args()
    if args.config and Path(args.config).exists():
        settings_path = Path(args.config)
        settings_stat = settings_path.stat()
        if os.name != 'nt' and (settings_path.is_symlink() or settings_stat.st_uid != 0 or settings_stat.st_mode & 0o022):
            parser.error('Capacity config must be a root-owned file without group/world write permission.')
        config = json.loads(settings_path.read_text('utf-8'))
        if set(config) - {'minFreeBytes', 'warnFreePercent'}:
            parser.error('Unknown capacity configuration key.')
        args.min_free_bytes = config.get('minFreeBytes', args.min_free_bytes)
        args.warn_free_percent = config.get('warnFreePercent', args.warn_free_percent)
    if not 1 <= args.batch <= 5000 or args.min_free_bytes < 0 or not 0 <= args.warn_free_percent <= 90:
        parser.error('Invalid capacity or batch setting.')
    if args.action == 'rollback-check':
        if not args.database:
            parser.error('--database required')
        result = rollback_check(args.database)
    elif args.action == 'cleanup-network':
        result = cleanup_network(args.network_dir)
    elif args.action == 'preflight':
        if not args.database:
            parser.error('--database required')
        result = preflight(args.database, args.min_free_bytes, args.warn_free_percent, args.health_url, args.allow_uninitialized)
    elif args.action == 'restore':
        if not args.archive_dir or not args.restore_to:
            parser.error('--archive-dir and --restore-to required')
        result = restore(args.archive_dir, args.restore_to)
    else:
        if not args.database or not args.archive_dir:
            parser.error('--database and --archive-dir required')
        result = backup(args.database, args.archive_dir, args.batch) if args.action == 'backup' else cleanup(args.database, args.archive_dir)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # No SQL/row values or request arguments in diagnostics.
        print('SECURITY OPERATIONS FAILED: ' + str(error), file=sys.stderr)
        sys.exit(1)
