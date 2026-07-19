import { test } from 'node:test';
import assert from 'node:assert/strict';
import { determineRunMode } from '../index.js';

test('determineRunMode returns ai_digest at 12h and 0h VN', () => {
  assert.equal(determineRunMode(new Date('2026-07-16T05:00:00Z')), 'ai_digest'); // 12:00 VN
  assert.equal(determineRunMode(new Date('2026-07-16T17:00:00Z')), 'ai_digest'); // 00:00 VN
});

test('determineRunMode returns link_digest at 8h, 16h, 20h VN', () => {
  assert.equal(determineRunMode(new Date('2026-07-16T01:00:00Z')), 'link_digest'); // 08:00 VN
  assert.equal(determineRunMode(new Date('2026-07-16T09:00:00Z')), 'link_digest'); // 16:00 VN
  assert.equal(determineRunMode(new Date('2026-07-16T13:00:00Z')), 'link_digest'); // 20:00 VN
});

test('determineRunMode returns fetch_only at all other hours', () => {
  assert.equal(determineRunMode(new Date('2026-07-16T00:00:00Z')), 'fetch_only'); // 07:00 VN
  assert.equal(determineRunMode(new Date('2026-07-16T10:00:00Z')), 'fetch_only'); // 17:00 VN
  assert.equal(determineRunMode(new Date('2026-07-16T16:00:00Z')), 'fetch_only'); // 23:00 VN
});
