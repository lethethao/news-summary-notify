import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatComplete } from '../src/githubModels.js';

test('chatComplete posts the prompt and returns trimmed content', async () => {
  let capturedUrl;
  let capturedHeaders;
  let capturedBody;
  const fakeFetch = async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '  Tóm tắt xong.  ' } }] }) };
  };
  const text = await chatComplete('tok', 'prompt nội dung', fakeFetch);
  assert.equal(text, 'Tóm tắt xong.');
  assert.equal(capturedUrl, 'https://models.github.ai/inference/chat/completions');
  assert.equal(capturedHeaders.Authorization, 'Bearer tok');
  assert.equal(capturedBody.model, 'openai/gpt-4o-mini');
  assert.equal(capturedBody.messages[0].content, 'prompt nội dung');
});

test('chatComplete throws on non-ok response', async () => {
  const fakeFetch = async () => ({ ok: false, status: 429, text: async () => 'Rate limited' });
  await assert.rejects(() => chatComplete('tok', 'prompt', fakeFetch), /429/);
});

test('chatComplete throws when content is empty', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '' } }] }) });
  await assert.rejects(() => chatComplete('tok', 'prompt', fakeFetch), /rỗng/);
});
