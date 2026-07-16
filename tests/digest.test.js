import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDigestText, splitDigestMessages, escapeHtml } from '../src/digest.js';

test('buildDigestText builds header and one HTML link line per item', () => {
  const items = [
    { title: 'Giá vàng tăng', link: 'https://a.example/1', sourceName: 'Vietnamnet' },
    { title: 'Fed giữ nguyên lãi suất', link: 'https://a.example/2', sourceName: 'Reuters' },
  ];
  const now = new Date(2026, 6, 13); // 13/07 (month is 0-indexed)
  const text = buildDigestText({ items, now });
  assert.equal(
    text,
    [
      '📰 Tổng hợp tin mới (13/07 - 4 tiếng qua)',
      '',
      '• <a href="https://a.example/1">Giá vàng tăng (Vietnamnet)</a>',
      '• <a href="https://a.example/2">Fed giữ nguyên lãi suất (Reuters)</a>',
    ].join('\n')
  );
});

test('buildDigestText HTML-escapes title and source text', () => {
  const items = [{ title: 'A & B <tag>', link: 'https://a.example/1', sourceName: 'X & Y' }];
  const text = buildDigestText({ items, now: new Date(2026, 6, 13) });
  assert.ok(text.includes('A &amp; B &lt;tag&gt; (X &amp; Y)'));
});

test('buildDigestText inserts the daily overview block when present', () => {
  const items = [{ title: 'T', link: 'https://a.example/1', sourceName: 'S' }];
  const text = buildDigestText({
    items,
    dailyOverview: { text: '• Chủ đề A\n• Chủ đề B' },
    now: new Date(2026, 6, 13),
  });
  assert.ok(text.includes('🔎 Tổng quan trong ngày:\n• Chủ đề A\n• Chủ đề B'));
});

test('buildDigestText inserts a warning when the daily overview failed', () => {
  const items = [{ title: 'T', link: 'https://a.example/1', sourceName: 'S' }];
  const text = buildDigestText({ items, dailyOverview: { failed: true }, now: new Date(2026, 6, 13) });
  assert.ok(text.includes('⚠️ Không tạo được tổng quan trong ngày (lỗi API)'));
});

test('buildDigestText inserts a warning when the monthly overview failed', () => {
  const items = [{ title: 'T', link: 'https://a.example/1', sourceName: 'S' }];
  const text = buildDigestText({ items, monthlyOverviewError: true, now: new Date(2026, 6, 13) });
  assert.ok(text.includes('⚠️ Không tạo được tổng quan tháng trước (lỗi API)'));
});

test('splitDigestMessages returns the whole text as one chunk when under the limit', () => {
  const text = 'line1\nline2';
  assert.deepEqual(splitDigestMessages(text, 4096), ['line1\nline2']);
});

test('splitDigestMessages splits on line boundaries without exceeding the limit', () => {
  const text = ['aaaa', 'bbbb', 'cccc'].join('\n'); // each line 4 chars
  const chunks = splitDigestMessages(text, 9); // fits "aaaa\nbbbb" (9 chars) but not a 3rd line
  assert.deepEqual(chunks, ['aaaa\nbbbb', 'cccc']);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 9);
  }
});

test('escapeHtml escapes ampersand, less-than, and greater-than', () => {
  assert.equal(escapeHtml('A & B <tag> C > D'), 'A &amp; B &lt;tag&gt; C &gt; D');
});
