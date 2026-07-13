import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSummarizer } from '../src/summarizer.js';

test('summarize returns trimmed text from Gemini response', async () => {
  const fakeAi = {
    models: {
      generateContent: async ({ model, contents }) => {
        assert.equal(model, 'gemini-2.5-flash');
        assert.match(contents, /Tiêu đề: Giá vàng tăng/);
        return { text: '  Giá vàng tăng mạnh hôm nay.  ' };
      },
    },
  };
  const summarizer = createSummarizer('fake-key', fakeAi);
  const summary = await summarizer.summarize({ title: 'Giá vàng tăng', content: 'Nội dung chi tiết...' });
  assert.equal(summary, 'Giá vàng tăng mạnh hôm nay.');
});

test('summarize throws when Gemini returns empty text', async () => {
  const fakeAi = { models: { generateContent: async () => ({ text: '' }) } };
  const summarizer = createSummarizer('fake-key', fakeAi);
  await assert.rejects(() => summarizer.summarize({ title: 'T', content: 'C' }), /rỗng/);
});
