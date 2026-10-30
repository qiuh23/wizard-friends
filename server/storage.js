import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

// Each row contains the complete Durable Object storage namespace for one
// room. One SQLite statement commits owner, authority, receipts and tombstone
// together; no acknowledged mutation can leave these at different revisions.
export class RoomStore {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o750 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    this.db.exec('CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, record TEXT NOT NULL)');
    this.saveStatement = this.db.prepare('INSERT INTO rooms(id, record) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET record=excluded.record');
  }
  all() { return this.db.prepare('SELECT id, record FROM rooms').all().map(row => [row.id, JSON.parse(row.record)]); }
  save(id, record) { this.saveStatement.run(id, JSON.stringify(record)); }
  close() { this.db.close(); }
}
