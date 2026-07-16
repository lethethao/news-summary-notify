import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, ConfigError } from '../src/config.js';

test('loadConfig returns all values when env is complete', () => {
  const env = {
    TELEGRAM_BOT_TOKEN: 'bot-token',
    TELEGRAM_CHAT_ID: 'chat-id',
    SHEET_CSV_URL: 'https://example.com/sheet.csv',
    YOUTUBE_API_KEY: 'youtube-key',
    GITHUB_TOKEN: 'gh-token',
  };
  const config = loadConfig(env);
  assert.equal(config.telegramBotToken, 'bot-token');
  assert.equal(config.telegramChatId, 'chat-id');
  assert.equal(config.sheetCsvUrl, 'https://example.com/sheet.csv');
  assert.equal(config.youtubeApiKey, 'youtube-key');
  assert.equal(config.githubToken, 'gh-token');
  assert.ok(config.dbPath.endsWith('data/app.db'));
});

test('loadConfig uses DB_PATH override when set', () => {
  const env = {
    TELEGRAM_BOT_TOKEN: 'bot-token',
    TELEGRAM_CHAT_ID: 'chat-id',
    SHEET_CSV_URL: 'https://example.com/sheet.csv',
    YOUTUBE_API_KEY: 'youtube-key',
    GITHUB_TOKEN: 'gh-token',
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
        ['GITHUB_TOKEN', 'SHEET_CSV_URL', 'TELEGRAM_CHAT_ID', 'YOUTUBE_API_KEY'].sort()
      );
      return true;
    }
  );
});
