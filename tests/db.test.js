import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDb } from '../src/db.js';

test('isSeen is false for unknown id, true after markSeen', () => {
  const db = createDb(':memory:');
  assert.equal(db.isSeen('item-1'), false);
  db.markSeen('item-1', 'Nguồn A', 'Tiêu đề 1', 'Mô tả 1', 'https://a.example/1', 1720000000);
  assert.equal(db.isSeen('item-1'), true);
  db.close();
});

test('markSeen is idempotent for the same id', () => {
  const db = createDb(':memory:');
  db.markSeen('item-1', 'Nguồn A', 'Tiêu đề 1', 'Mô tả 1', 'https://a.example/1', 1720000000);
  db.markSeen('item-1', 'Nguồn A', 'Tiêu đề 1', 'Mô tả 1', 'https://a.example/1', 1720000001);
  assert.equal(db.isSeen('item-1'), true);
  db.close();
});

test('markSeen defaults seenAt to current unix time', () => {
  const db = createDb(':memory:');
  const before = Math.floor(Date.now() / 1000);
  db.markSeen('item-2', 'Nguồn B', 'Tiêu đề 2', 'Mô tả 2', 'https://a.example/2');
  assert.equal(db.isSeen('item-2'), true);
  assert.ok(before <= Math.floor(Date.now() / 1000));
  db.close();
});

test('getTodayItems returns only items seen at or after the given timestamp, oldest first, including link', () => {
  const db = createDb(':memory:');
  db.markSeen('item-1', 'Nguồn A', 'Tiêu đề 1', 'Mô tả 1', 'https://a.example/1', 1000);
  db.markSeen('item-2', 'Nguồn B', 'Tiêu đề 2', 'Mô tả 2', 'https://a.example/2', 2000);
  db.markSeen('item-3', 'Nguồn C', 'Tiêu đề 3', 'Mô tả 3', 'https://a.example/3', 3000);
  const items = db.getTodayItems(2000);
  assert.deepEqual(items, [
    { sourceName: 'Nguồn B', title: 'Tiêu đề 2', description: 'Mô tả 2', link: 'https://a.example/2' },
    { sourceName: 'Nguồn C', title: 'Tiêu đề 3', description: 'Mô tả 3', link: 'https://a.example/3' },
  ]);
  db.close();
});

test('upsertDailyOverview inserts then overwrites for the same date', () => {
  const db = createDb(':memory:');
  db.upsertDailyOverview('2026-07-16', '• bản đầu', 1000);
  db.upsertDailyOverview('2026-07-16', '• bản cập nhật', 2000);
  const rows = db.getDailyOverviewsForMonth('2026-07');
  assert.deepEqual(rows, [{ date: '2026-07-16', text: '• bản cập nhật' }]);
  db.close();
});

test('getDailyOverviewsForMonth only returns rows within that month, sorted by date', () => {
  const db = createDb(':memory:');
  db.upsertDailyOverview('2026-06-30', '• tháng 6', 1000);
  db.upsertDailyOverview('2026-07-02', '• tháng 7 ngày 2', 1000);
  db.upsertDailyOverview('2026-07-01', '• tháng 7 ngày 1', 1000);
  const rows = db.getDailyOverviewsForMonth('2026-07');
  assert.deepEqual(rows, [
    { date: '2026-07-01', text: '• tháng 7 ngày 1' },
    { date: '2026-07-02', text: '• tháng 7 ngày 2' },
  ]);
  db.close();
});

test('getMonthlyOverview returns undefined when missing, {text, sent:false} after save, {text, sent:true} after markMonthlyOverviewSent', () => {
  const db = createDb(':memory:');
  assert.equal(db.getMonthlyOverview('2026-06'), undefined);
  db.saveMonthlyOverview('2026-06', '• tổng quan tháng 6', 1000);
  assert.deepEqual(db.getMonthlyOverview('2026-06'), { text: '• tổng quan tháng 6', sent: false });
  db.markMonthlyOverviewSent('2026-06');
  assert.deepEqual(db.getMonthlyOverview('2026-06'), { text: '• tổng quan tháng 6', sent: true });
  db.close();
});

test('ensureColumn migration adds the link column to a pre-existing seen_items table without it', () => {
  const dbPath = path.join(os.tmpdir(), `migration-test-link-${Date.now()}.db`);
  const oldDb = new DatabaseSync(dbPath);
  oldDb.exec(
    'CREATE TABLE seen_items (id TEXT PRIMARY KEY, source_name TEXT, seen_at INTEGER, title TEXT, description TEXT)'
  );
  oldDb
    .prepare('INSERT INTO seen_items (id, source_name, seen_at, title, description) VALUES (?, ?, ?, ?, ?)')
    .run('old-item', 'Nguồn cũ', 1000, 'Tiêu đề cũ', 'Mô tả cũ');
  oldDb.close();

  const db = createDb(dbPath);
  const items = db.getTodayItems(500);
  assert.deepEqual(items, [{ sourceName: 'Nguồn cũ', title: 'Tiêu đề cũ', description: 'Mô tả cũ', link: null }]);
  db.close();
  fs.unlinkSync(dbPath);
});
