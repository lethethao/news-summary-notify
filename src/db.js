import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function ensureColumn(db, table, column, type) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = columns.some((col) => col.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

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
  ensureColumn(db, 'seen_items', 'title', 'TEXT');
  ensureColumn(db, 'seen_items', 'description', 'TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_overviews (
      date TEXT PRIMARY KEY,
      overview_text TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS monthly_overviews (
      month TEXT PRIMARY KEY,
      overview_text TEXT NOT NULL,
      sent INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `);

  const isSeenStmt = db.prepare('SELECT 1 FROM seen_items WHERE id = ?');
  const markSeenStmt = db.prepare(
    'INSERT OR IGNORE INTO seen_items (id, source_name, seen_at, title, description) VALUES (?, ?, ?, ?, ?)'
  );
  const getTodayItemsStmt = db.prepare(
    'SELECT source_name AS sourceName, title, description FROM seen_items WHERE seen_at >= ? AND title IS NOT NULL ORDER BY seen_at ASC'
  );
  const upsertDailyOverviewStmt = db.prepare(
    'INSERT INTO daily_overviews (date, overview_text, updated_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(date) DO UPDATE SET overview_text = excluded.overview_text, updated_at = excluded.updated_at'
  );
  const getDailyOverviewsForMonthStmt = db.prepare(
    'SELECT date, overview_text AS text FROM daily_overviews WHERE date LIKE ? ORDER BY date ASC'
  );
  const getMonthlyOverviewStmt = db.prepare('SELECT overview_text, sent FROM monthly_overviews WHERE month = ?');
  const saveMonthlyOverviewStmt = db.prepare(
    'INSERT OR REPLACE INTO monthly_overviews (month, overview_text, sent, created_at) VALUES (?, ?, 0, ?)'
  );
  const markMonthlyOverviewSentStmt = db.prepare('UPDATE monthly_overviews SET sent = 1 WHERE month = ?');

  return {
    isSeen(id) {
      return isSeenStmt.get(id) !== undefined;
    },
    markSeen(id, sourceName, title, description, seenAt = Math.floor(Date.now() / 1000)) {
      markSeenStmt.run(id, sourceName, seenAt, title, description);
    },
    getTodayItems(sinceTs) {
      return getTodayItemsStmt.all(sinceTs).map(obj => ({...obj}));
    },
    upsertDailyOverview(date, text, updatedAt = Math.floor(Date.now() / 1000)) {
      upsertDailyOverviewStmt.run(date, text, updatedAt);
    },
    getDailyOverviewsForMonth(monthKey) {
      return getDailyOverviewsForMonthStmt.all(`${monthKey}-%`).map(obj => ({...obj}));
    },
    getMonthlyOverview(monthKey) {
      const row = getMonthlyOverviewStmt.get(monthKey);
      return row ? { text: row.overview_text, sent: row.sent === 1 } : undefined;
    },
    saveMonthlyOverview(monthKey, text, createdAt = Math.floor(Date.now() / 1000)) {
      saveMonthlyOverviewStmt.run(monthKey, text, createdAt);
    },
    markMonthlyOverviewSent(monthKey) {
      markMonthlyOverviewSentStmt.run(monthKey);
    },
    close() {
      db.close();
    },
  };
}
