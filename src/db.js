import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function createDb(dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS seen_items (
      id TEXT PRIMARY KEY,
      source_name TEXT,
      seen_at INTEGER
    )
  `);

  const isSeenStmt = db.prepare('SELECT 1 FROM seen_items WHERE id = ?');
  const markSeenStmt = db.prepare(
    'INSERT OR IGNORE INTO seen_items (id, source_name, seen_at) VALUES (?, ?, ?)'
  );

  return {
    isSeen(id) {
      return isSeenStmt.get(id) !== undefined;
    },
    markSeen(id, sourceName, seenAt = Math.floor(Date.now() / 1000)) {
      markSeenStmt.run(id, sourceName, seenAt);
    },
    close() {
      db.close();
    },
  };
}
