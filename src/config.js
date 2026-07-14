import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED_KEYS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'GEMINI_API_KEY', 'SHEET_CSV_URL', 'YOUTUBE_API_KEY'];

export class ConfigError extends Error {
  constructor(missingKeys) {
    super(`Thiếu biến môi trường: ${missingKeys.join(', ')}`);
    this.name = 'ConfigError';
    this.missingKeys = missingKeys;
  }
}

export function loadConfig(env = process.env) {
  const missingKeys = REQUIRED_KEYS.filter((key) => !env[key]);
  if (missingKeys.length > 0) {
    throw new ConfigError(missingKeys);
  }
  return {
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    telegramChatId: env.TELEGRAM_CHAT_ID,
    geminiApiKey: env.GEMINI_API_KEY,
    sheetCsvUrl: env.SHEET_CSV_URL,
    youtubeApiKey: env.YOUTUBE_API_KEY,
    dbPath: env.DB_PATH || path.join(ROOT_DIR, 'data', 'app.db'),
  };
}
