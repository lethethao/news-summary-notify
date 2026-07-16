import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyPrompt, buildMonthlyPrompt, createOverviewSummarizer } from '../src/overview.js';

test('buildDailyPrompt lists numbered source/title/description per line and asks for citations', () => {
  const items = [
    { sourceName: 'Vietnamnet', title: 'Giá vàng tăng', description: 'Vàng SJC lên 90 triệu' },
    { sourceName: 'YouTube Kinh tế', title: 'Bản tin chiều', description: '' },
  ];
  const prompt = buildDailyPrompt(items);
  assert.match(prompt, /\[1\] \[Vietnamnet\] Giá vàng tăng: Vàng SJC lên 90 triệu/);
  assert.match(prompt, /\[2\] \[YouTube Kinh tế\] Bản tin chiều\n/);
  assert.match(prompt, /gạch đầu dòng/);
  assert.match(prompt, /số tham chiếu/);
});

test('buildMonthlyPrompt lists each day\'s overview text and the month label', () => {
  const dailyOverviews = [
    { date: '2026-06-01', text: '• Chủ đề A' },
    { date: '2026-06-02', text: '• Chủ đề B' },
  ];
  const prompt = buildMonthlyPrompt(dailyOverviews, '06/2026');
  assert.match(prompt, /2026-06-01:\n• Chủ đề A/);
  assert.match(prompt, /2026-06-02:\n• Chủ đề B/);
  assert.match(prompt, /tháng 06\/2026/);
});

test('summarizeDaily calls chatFn with the numbered prompt and returns its result', async () => {
  let capturedToken;
  let capturedPrompt;
  const fakeChat = async (token, prompt) => {
    capturedToken = token;
    capturedPrompt = prompt;
    return '• Chủ đề A [1]\n• Chủ đề B [1]';
  };
  const summarizer = createOverviewSummarizer('tok', fakeChat);
  const result = await summarizer.summarizeDaily([{ sourceName: 'X', title: 'T', description: '' }]);
  assert.equal(result, '• Chủ đề A [1]\n• Chủ đề B [1]');
  assert.equal(capturedToken, 'tok');
  assert.match(capturedPrompt, /\[1\] \[X\] T/);
});

test('summarizeDaily returns null for empty items without calling chatFn', async () => {
  const summarizer = createOverviewSummarizer('tok', async () => {
    throw new Error('should not be called');
  });
  assert.equal(await summarizer.summarizeDaily([]), null);
});

test('summarizeMonthly returns null for empty dailyOverviews without calling chatFn', async () => {
  const summarizer = createOverviewSummarizer('tok', async () => {
    throw new Error('should not be called');
  });
  assert.equal(await summarizer.summarizeMonthly([], '06/2026'), null);
});

test('summarizeMonthly propagates chatFn errors', async () => {
  const summarizer = createOverviewSummarizer('tok', async () => {
    throw new Error('HTTP 500');
  });
  await assert.rejects(
    () => summarizer.summarizeMonthly([{ date: '2026-06-01', text: 'x' }], '06/2026'),
    /500/
  );
});
