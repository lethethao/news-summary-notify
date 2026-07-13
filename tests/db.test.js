import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/db.js';

test('isSeen is false for unknown id, true after markSeen', () => {
  const db = createDb(':memory:');
  assert.equal(db.isSeen('item-1'), false);
  db.markSeen('item-1', 'Nguồn A', 1720000000);
  assert.equal(db.isSeen('item-1'), true);
  db.close();
});

test('markSeen is idempotent for the same id', () => {
  const db = createDb(':memory:');
  db.markSeen('item-1', 'Nguồn A', 1720000000);
  db.markSeen('item-1', 'Nguồn A', 1720000001);
  assert.equal(db.isSeen('item-1'), true);
  db.close();
});

test('markSeen defaults seenAt to current unix time', () => {
  const db = createDb(':memory:');
  const before = Math.floor(Date.now() / 1000);
  db.markSeen('item-2', 'Nguồn B');
  assert.equal(db.isSeen('item-2'), true);
  assert.ok(before <= Math.floor(Date.now() / 1000));
  db.close();
});
