import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanDescription } from '../src/textClean.js';

test('cleanDescription removes bare URLs', () => {
  assert.equal(cleanDescription('Xem thêm tại https://example.com/xyz nhé'), 'Xem thêm tại nhé');
});

test('cleanDescription drops lines containing ad keywords', () => {
  const input = [
    'Video nói về kinh tế Việt Nam.',
    'Theo dõi Facebook: fb.com/abc',
    'Zalo: 0909xxxxxx',
    'Tải app Android tại đây',
  ].join('\n');
  assert.equal(cleanDescription(input), 'Video nói về kinh tế Việt Nam.');
});

test('cleanDescription collapses whitespace and trims', () => {
  assert.equal(cleanDescription('  Hello   world  \n\n  '), 'Hello world');
});

test('cleanDescription truncates to 300 characters', () => {
  const longText = 'a'.repeat(400);
  assert.equal(cleanDescription(longText).length, 300);
});

test('cleanDescription returns empty string for falsy input', () => {
  assert.equal(cleanDescription(''), '');
  assert.equal(cleanDescription(null), '');
  assert.equal(cleanDescription(undefined), '');
});

test('cleanDescription returns empty string when every line is filtered out', () => {
  assert.equal(cleanDescription('Facebook: fb.com/abc'), '');
});
