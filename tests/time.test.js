import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startOfDayVN, vnDateKey, isFirstDayOfMonthVN, previousMonthKey } from '../src/time.js';

test('startOfDayVN returns 00:00 VN for a time within the VN day', () => {
  const now = new Date('2026-07-16T10:00:00Z'); // 17:00 VN same calendar day
  const start = startOfDayVN(now);
  const expected = Math.floor(new Date('2026-07-15T17:00:00Z').getTime() / 1000); // 00:00 VN Jul 16 = 17:00 UTC Jul 15
  assert.equal(start, expected);
});

test('vnDateKey rolls over at VN midnight, not UTC midnight', () => {
  const beforeVnMidnight = new Date('2026-07-16T16:59:00Z'); // 23:59 VN Jul 16
  assert.equal(vnDateKey(beforeVnMidnight), '2026-07-16');
  const afterVnMidnight = new Date('2026-07-16T17:00:00Z'); // 00:00 VN Jul 17
  assert.equal(vnDateKey(afterVnMidnight), '2026-07-17');
});

test('isFirstDayOfMonthVN is true only once VN date rolls to the 1st', () => {
  assert.equal(isFirstDayOfMonthVN(new Date('2026-07-31T16:59:00Z')), false); // still 23:59 VN Jul 31
  assert.equal(isFirstDayOfMonthVN(new Date('2026-07-31T17:00:00Z')), true); // 00:00 VN Aug 1
});

test('previousMonthKey returns the prior month for a normal month', () => {
  assert.equal(previousMonthKey(new Date('2026-07-16T10:00:00Z')), '2026-06');
});

test('previousMonthKey rolls back across a year boundary', () => {
  const jan1Vn = new Date('2025-12-31T17:00:00Z'); // 00:00 VN Jan 1 2026
  assert.equal(previousMonthKey(jan1Vn), '2025-12');
});
