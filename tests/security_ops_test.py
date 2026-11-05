"""Functional recovery/retention tests; no cloud access or production paths."""
import calendar
from collections import namedtuple
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('security_ops', Path(__file__).parents[1] / 'scripts/deploy/security-ops.py')
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)


class SecurityOperationsTests(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.TemporaryDirectory()
        self.root = Path(self.work.name)
        self.database = self.root / 'security.sqlite'
        self.archive = self.root / 'archive'
        self.now = 2_000_000_000_000
        with ops.database_connection(self.database) as db:
            db.executescript('''CREATE TABLE security_events(id INTEGER PRIMARY KEY AUTOINCREMENT,at INTEGER NOT NULL,expires_at INTEGER NOT NULL,held INTEGER NOT NULL DEFAULT 0,event TEXT NOT NULL);
            CREATE TABLE moderation(room_code TEXT NOT NULL,kind TEXT NOT NULL,target TEXT NOT NULL,at INTEGER NOT NULL,expires_at INTEGER NOT NULL,event_id INTEGER,PRIMARY KEY(room_code,kind,target));
            CREATE TABLE security_evidence(id INTEGER PRIMARY KEY,room_code TEXT NOT NULL,at INTEGER NOT NULL,expires_at INTEGER NOT NULL,held INTEGER NOT NULL DEFAULT 0,evidence TEXT NOT NULL);''')

    def tearDown(self):
        self.work.cleanup()

    def event(self, expires, held=0):
        with ops.database_connection(self.database) as db:
            result = db.execute('INSERT INTO security_events(at,expires_at,held,event) VALUES(?,?,?,?)', (self.now - 10, expires, held, json.dumps({'kind': 'network', 'operation': 'connect'})))
            return result.lastrowid

    def test_incremental_recovery_keeps_late_holds_moderation_and_evidence(self):
        expired = self.event(self.now - 1)
        retained = self.event(self.now + 100)
        ops.backup(self.database, self.archive, batch=1, now=self.now)
        first_files = set(self.archive.glob('events-*.gz'))
        with ops.database_connection(self.database) as db:
            # A hold added after archival must survive an expired record restore.
            db.execute('UPDATE security_events SET held=1 WHERE id=?', (expired,))
            db.execute('INSERT INTO moderation VALUES(?,?,?,?,?,?)', ('ABCDEF', 'hidden', 'chat-1', self.now, self.now + 100, expired))
            db.execute('INSERT INTO security_evidence VALUES(?,?,?,?,?,?)', (expired, 'ABCDEF', self.now, self.now - 1, 1, '{"message":"targeted evidence"}'))
        new = self.event(self.now + 200)
        self.assertEqual(ops.backup(self.database, self.archive, batch=1, now=self.now)['archivedEvents'], 1)
        self.assertTrue(first_files.issubset(set(self.archive.glob('events-*.gz'))))
        target = self.root / 'restored.sqlite'
        self.assertEqual(ops.restore(self.archive, target, now=self.now)['restoredEvents'], 3)
        with ops.database_connection(target) as db:
            self.assertEqual(db.execute('SELECT held FROM security_events WHERE id=?', (expired,)).fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT target FROM moderation').fetchone()[0], 'chat-1')
            self.assertEqual(db.execute('SELECT COUNT(*) FROM security_evidence').fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT seq FROM sqlite_sequence').fetchone()[0], new)
        self.assertEqual(retained, 2)

    def test_expiry_cleanup_never_deletes_current_hold_and_restore_excludes_expired(self):
        gone = self.event(self.now - 1)
        held = self.event(self.now - 1, 1)
        keep = self.event(self.now + 100)
        ops.backup(self.database, self.archive, batch=1, now=self.now)
        self.assertEqual(ops.cleanup(self.database, self.archive, now=self.now)['deletedSegments'], 1)
        target = self.root / 'restored.sqlite'
        ops.restore(self.archive, target, now=self.now)
        with ops.database_connection(target) as db:
            self.assertEqual([row[0] for row in db.execute('SELECT id FROM security_events ORDER BY id')], [held, keep])
        self.assertEqual(gone, 1)

    def test_hold_release_changes_old_immutable_segment_on_restore(self):
        released = self.event(self.now - 1, 1)
        ops.backup(self.database, self.archive, now=self.now)
        with ops.database_connection(self.database) as db:
            db.execute('UPDATE security_events SET held=0 WHERE id=?', (released,))
        ops.backup(self.database, self.archive, now=self.now)
        target = self.root / 'restored.sqlite'
        self.assertEqual(ops.restore(self.archive, target, now=self.now)['restoredEvents'], 0)

    def test_missing_and_corrupt_segments_and_incomplete_snapshot_are_rejected(self):
        self.event(self.now + 100)
        ops.backup(self.database, self.archive, now=self.now)
        segment = next(self.archive.glob('events-*.gz'))
        data = segment.read_bytes()
        segment.unlink()
        with self.assertRaisesRegex(ValueError, 'missing'):
            ops.restore(self.archive, self.root / 'missing.sqlite', now=self.now)
        with self.assertRaisesRegex(ValueError, 'missing'):
            ops.backup(self.database, self.archive, now=self.now)
        segment.write_bytes(data + b'corrupt')
        with self.assertRaisesRegex(ValueError, 'size|checksum'):
            ops.restore(self.archive, self.root / 'corrupt.sqlite', now=self.now)
        segment.write_bytes(bytes([data[0] ^ 1]) + data[1:])
        with self.assertRaisesRegex(ValueError, 'checksum'):
            ops.restore(self.archive, self.root / 'same-size-corrupt.sqlite', now=self.now)
        segment.write_bytes(data)
        (self.archive / 'cursor.json').write_text('{"lastId":2}', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'incomplete'):
            ops.restore(self.archive, self.root / 'partial.sqlite', now=self.now)

    def test_capacity_refuses_release_without_deleting_data(self):
        self.event(self.now + 100)
        before = self.database.read_bytes()
        Usage = namedtuple('Usage', 'total used free')
        with self.assertRaisesRegex(ValueError, 'new release refused'):
            ops.preflight(self.database, minimum=100, percent=10, space=lambda _: Usage(1000, 950, 50))
        self.assertEqual(self.database.read_bytes(), before)
        self.assertEqual(ops.preflight(self.database, minimum=100, percent=10, space=lambda _: Usage(1000, 500, 500))['freeBytes'], 500)

    def test_network_logs_use_calendar_months_and_hold(self):
        logs = self.root / 'logs'
        logs.mkdir()
        # 31 August -> 28 February, not an under-length fixed 180 day period.
        at = calendar.timegm((2026, 8, 31, 12, 0, 0))
        expiry = calendar.timegm((2027, 2, 28, 12, 0, 0))
        self.assertEqual(ops.six_months_after(at), expiry)
        path = logs / 'wizard.log-20260831T120000.gz'
        path.write_bytes(b'fixture')
        os.utime(path, (at, at))
        self.assertEqual(ops.cleanup_network(logs, expiry - 1)['deletedNetworkLogs'], 0)
        (logs / 'HOLD').touch()
        self.assertEqual(ops.cleanup_network(logs, expiry)['deletedNetworkLogs'], 0)
        (logs / 'HOLD').unlink()
        self.assertEqual(ops.cleanup_network(logs, expiry)['deletedNetworkLogs'], 1)

    def test_restore_does_not_overwrite_existing_database(self):
        self.event(self.now + 100)
        ops.backup(self.database, self.archive, now=self.now)
        with self.assertRaisesRegex(ValueError, 'absent path'):
            ops.restore(self.archive, self.database, now=self.now)

    def test_empty_database_backup_restores_and_wizard_usage_rebuilds(self):
        with ops.database_connection(self.database) as db:
            db.execute('CREATE TABLE security_moderation(room TEXT PRIMARY KEY,state TEXT NOT NULL,expires_at INTEGER NOT NULL,held INTEGER NOT NULL DEFAULT 0)')
            db.execute('INSERT INTO security_moderation VALUES(?,?,?,?)', ('ABCDEF', '{"hidden":["chat1"]}', self.now+100, 0))
        ops.backup(self.database, self.archive, now=self.now)
        target = self.root / 'empty-restored.sqlite'
        self.assertEqual(ops.restore(self.archive, target, now=self.now)['restoredEvents'], 0)
        with ops.database_connection(target) as db:
            before = db.execute('SELECT bytes FROM security_usage').fetchone()[0]
            self.assertGreater(before, 0)
            db.execute('INSERT INTO security_events(at,expires_at,event) VALUES(?,?,?)', (self.now,self.now+100,'{}'))
            self.assertEqual(db.execute('SELECT bytes FROM security_usage').fetchone()[0], before+258)

    def test_short_term_content_does_not_inherit_network_archive_lifetime(self):
        short = self.event(self.now + 90 * 86400000)
        long = self.event(self.now + 200 * 86400000)
        ops.backup(self.database, self.archive, batch=5000, now=self.now)
        self.assertEqual(len(list(self.archive.glob('events-*.gz'))), 2)
        later = self.now + 91 * 86400000
        self.assertEqual(ops.cleanup(self.database, self.archive, now=later)['deletedSegments'], 1)
        target = self.root / 'later.sqlite'
        ops.restore(self.archive, target, now=later)
        with ops.database_connection(target) as db:
            self.assertEqual([row[0] for row in db.execute('SELECT id FROM security_events')], [long])
        self.assertEqual(short, 1)

    def test_legacy_rollback_cannot_bypass_existing_audit_or_hidden_content(self):
        self.assertTrue(ops.rollback_check(self.database)['legacyRollbackSafe'])
        with ops.database_connection(self.database) as db:
            db.execute('INSERT INTO moderation VALUES(?,?,?,?,?,?)', ('ABCDEF', 'hidden', 'chat-1', self.now, self.now + 100, None))
        with self.assertRaisesRegex(ValueError, 'Legacy rollback refused'):
            ops.rollback_check(self.database)


if __name__ == '__main__':
    unittest.main()
