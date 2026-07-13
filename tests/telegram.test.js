import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendTelegramMessage, sendDigest, sendAlert } from '../src/telegram.js';

const config = { telegramBotToken: 'tok', telegramChatId: 'chat' };

test('sendTelegramMessage posts to the Telegram API with HTML parse mode', async () => {
  let capturedUrl;
  let capturedBody;
  const fakeFetch = async (url, options) => {
    capturedUrl = url;
    capturedBody = JSON.parse(options.body);
    return { ok: true };
  };
  await sendTelegramMessage({ botToken: 'tok', chatId: 'chat', text: 'hello' }, fakeFetch);
  assert.equal(capturedUrl, 'https://api.telegram.org/bottok/sendMessage');
  assert.equal(capturedBody.chat_id, 'chat');
  assert.equal(capturedBody.text, 'hello');
  assert.equal(capturedBody.parse_mode, 'HTML');
});

test('sendTelegramMessage throws on non-ok response', async () => {
  const fakeFetch = async () => ({ ok: false, status: 401, text: async () => 'Unauthorized' });
  await assert.rejects(
    () => sendTelegramMessage({ botToken: 'tok', chatId: 'chat', text: 'hi' }, fakeFetch),
    /401/
  );
});

test('sendDigest splits long text and sends each chunk in order', async () => {
  const sentTexts = [];
  const fakeFetch = async (url, options) => {
    sentTexts.push(JSON.parse(options.body).text);
    return { ok: true };
  };
  const longLine = 'x'.repeat(5000);
  await sendDigest(config, longLine, fakeFetch);
  assert.equal(sentTexts.length, 1); // a single unsplittable line stays one chunk even if over limit
  assert.equal(sentTexts[0], longLine);
});

test('sendAlert returns true on success and formats the alert text', async () => {
  let capturedText;
  const fakeFetch = async (url, options) => {
    capturedText = JSON.parse(options.body).text;
    return { ok: true };
  };
  const ok = await sendAlert(config, 'Không đọc được Google Sheet', 'HTTP 500', fakeFetch);
  assert.equal(ok, true);
  assert.equal(capturedText, '🔴 [news_summary_notify] Lỗi: Không đọc được Google Sheet\nHTTP 500');
});

test('sendAlert returns false instead of throwing when Telegram itself fails', async () => {
  const fakeFetch = async () => ({ ok: false, status: 401, text: async () => 'Unauthorized' });
  const ok = await sendAlert(config, 'desc', 'detail', fakeFetch);
  assert.equal(ok, false);
});
