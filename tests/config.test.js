import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, ConfigError } from '../src/config.js';

test('loadConfig returns all values when env is complete', () => {
  const env = {
    TELEGRAM_BOT_TOKEN: 'bot-token',
    TELEGRAM_CHAT_ID: 'chat-id',
    GEMINI_API_KEY: 'gemini-key',
    SHEET_CSV_URL: 'https://example.com/sheet.csv',
  };
  const config = loadConfig(env);
  assert.equal(config.telegramBotToken, 'bot-token');
  assert.equal(config.telegramChatId, 'chat-id');
  assert.equal(config.geminiApiKey, 'gemini-key');
  assert.equal(config.sheetCsvUrl, 'https://example.com/sheet.csv');
  assert.ok(config.dbPath.endsWith('data/app.db'));
});

test('loadConfig uses DB_PATH override when set', () => {
  const env = {
    TELEGRAM_BOT_TOKEN: 'bot-token',
    TELEGRAM_CHAT_ID: 'chat-id',
    GEMINI_API_KEY: 'gemini-key',
    SHEET_CSV_URL: 'https://example.com/sheet.csv',
    DB_PATH: '/tmp/custom.db',
  };
  const config = loadConfig(env);
  assert.equal(config.dbPath, '/tmp/custom.db');
});

test('loadConfig throws ConfigError listing missing keys', () => {
  const env = { TELEGRAM_BOT_TOKEN: 'bot-token' };
  assert.throws(
    () => loadConfig(env),
    (err) => {
      assert.ok(err instanceof ConfigError);
      assert.deepEqual(
        err.missingKeys.sort(),
        ['GEMINI_API_KEY', 'SHEET_CSV_URL', 'TELEGRAM_CHAT_ID'].sort()
      );
      return true;
    }
  );
});
