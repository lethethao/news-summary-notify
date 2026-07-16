import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/db.js';

test('isSeen is false for unknown id, true after markSeen', () => {
  const db = createDb(':memory:');
  assert.equal(db.isSeen('item-1'), false);
  db.markSeen('item-1', 'Nguồn A', 'Tiêu đề 1', 'Mô tả 1', 1720000000);
  assert.equal(db.isSeen('item-1'), true);
  db.close();
});

test('markSeen is idempotent for the same id', () => {
  const db = createDb(':memory:');
  db.markSeen('item-1', 'Nguồn A', 'Tiêu đề 1', 'Mô tả 1', 1720000000);
  db.markSeen('item-1', 'Nguồn A', 'Tiêu đề 1', 'Mô tả 1', 1720000001);
  assert.equal(db.isSeen('item-1'), true);
  db.close();
});

test('markSeen defaults seenAt to current unix time', () => {
  const db = createDb(':memory:');
  const before = Math.floor(Date.now() / 1000);
  db.markSeen('item-2', 'Nguồn B', 'Tiêu đề 2', 'Mô tả 2');
  assert.equal(db.isSeen('item-2'), true);
  assert.ok(before <= Math.floor(Date.now() / 1000));
  db.close();
});

test('getTodayItems returns only items seen at or after the given timestamp, oldest first', () => {
  const db = createDb(':memory:');
  db.markSeen('item-1', 'Nguồn A', 'Tiêu đề 1', 'Mô tả 1', 1000);
  db.markSeen('item-2', 'Nguồn B', 'Tiêu đề 2', 'Mô tả 2', 2000);
  db.markSeen('item-3', 'Nguồn C', 'Tiêu đề 3', 'Mô tả 3', 3000);
  const items = db.getTodayItems(2000);
  assert.deepEqual(items, [
    { sourceName: 'Nguồn B', title: 'Tiêu đề 2', description: 'Mô tả 2' },
    { sourceName: 'Nguồn C', title: 'Tiêu đề 3', description: 'Mô tả 3' },
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

test('getMonthlyOverview returns undefined when missing, then the saved value after save', () => {
  const db = createDb(':memory:');
  assert.equal(db.getMonthlyOverview('2026-06'), undefined);
  db.saveMonthlyOverview('2026-06', '• tổng quan tháng 6', 1000);
  assert.equal(db.getMonthlyOverview('2026-06'), '• tổng quan tháng 6');
  db.close();
});
