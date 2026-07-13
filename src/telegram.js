import { splitDigestMessages } from './digest.js';

const API_BASE = 'https://api.telegram.org';
const MESSAGE_LIMIT = 4096;

export async function sendTelegramMessage({ botToken, chatId, text }, fetchImpl = fetch) {
  const res = await fetchImpl(`${API_BASE}/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API lỗi: HTTP ${res.status} - ${body}`);
  }
}

export async function sendDigest(config, digestText, fetchImpl = fetch) {
  const chunks = splitDigestMessages(digestText, MESSAGE_LIMIT);
  for (const chunk of chunks) {
    await sendTelegramMessage(
      { botToken: config.telegramBotToken, chatId: config.telegramChatId, text: chunk },
      fetchImpl
    );
  }
}

export async function sendAlert(config, shortDesc, detail, fetchImpl = fetch) {
  const text = `🔴 [news_summary_notify] Lỗi: ${shortDesc}\n${detail}`;
  try {
    await sendTelegramMessage(
      { botToken: config.telegramBotToken, chatId: config.telegramChatId, text },
      fetchImpl
    );
    return true;
  } catch (err) {
    console.error('Không gửi được cảnh báo qua Telegram:', err.message);
    return false;
  }
}
