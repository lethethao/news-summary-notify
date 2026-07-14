import 'dotenv/config';
import { loadConfig } from './src/config.js';
import { fetchSources } from './src/sources.js';
import { fetchFeed } from './src/feeds.js';
import { fetchYoutubeChannelFeed } from './src/youtubeFeed.js';
import { createDb } from './src/db.js';
import { fetchTranscriptText } from './src/youtube.js';
import { createSummarizer } from './src/summarizer.js';
import { buildDigestText } from './src/digest.js';
import { sendDigest, sendAlert } from './src/telegram.js';

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(err.message);
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (botToken && chatId) {
      await sendAlert({ telegramBotToken: botToken, telegramChatId: chatId }, 'Config lỗi', err.message);
    }
    process.exit(1);
    return;
  }

  let sources;
  try {
    sources = await fetchSources(config.sheetCsvUrl);
  } catch (err) {
    console.error('Không đọc được Google Sheet:', err.message);
    await sendAlert(config, 'Không đọc được Google Sheet', err.message);
    process.exit(1);
    return;
  }

  const db = createDb(config.dbPath);
  const summarizer = createSummarizer(config.geminiApiKey);

  const newItems = [];
  for (const source of sources) {
    let feedItems;
    try {
      feedItems = source.type === 'youtube'
        ? await fetchYoutubeChannelFeed(source.url, config.youtubeApiKey)
        : await fetchFeed(source.url);
    } catch (err) {
      console.error(`Bỏ qua nguồn "${source.name}" (${source.url}): ${err.message}`);
      continue;
    }
    for (const item of feedItems) {
      if (db.isSeen(item.id)) continue;
      newItems.push({ ...item, sourceName: source.name, sourceType: source.type });
    }
  }

  if (newItems.length === 0) {
    console.log('Không có tin mới.');
    db.close();
    process.exit(0);
    return;
  }

  let geminiAttempts = 0;
  let geminiSuccesses = 0;
  const digestItems = [];

  for (const item of newItems) {
    let content = item.snippet;
    if (item.sourceType === 'youtube') {
      const transcript = await fetchTranscriptText(item.link);
      content = transcript || item.snippet;
    }

    geminiAttempts += 1;
    let summary;
    try {
      summary = await summarizer.summarize({ title: item.title, content });
      geminiSuccesses += 1;
    } catch (err) {
      console.error(`Tóm tắt lỗi cho "${item.title}": ${err.message}`);
      summary = item.title;
    }

    digestItems.push({ summary, link: item.link, sourceName: item.sourceName });
  }

  let digestText = buildDigestText(digestItems);
  if (geminiAttempts > 0 && geminiSuccesses === 0) {
    digestText = `⚠️ Gemini API lỗi, hiển thị nội dung gốc chưa tóm tắt\n\n${digestText}`;
  }

  try {
    await sendDigest(config, digestText);
  } catch (err) {
    console.error('Gửi Telegram thất bại:', err.message);
    db.close();
    process.exit(1);
    return;
  }

  const seenAt = Math.floor(Date.now() / 1000);
  for (const item of newItems) {
    db.markSeen(item.id, item.sourceName, seenAt);
  }
  db.close();
  console.log(`Đã gửi digest với ${newItems.length} tin mới.`);
  process.exit(0);
}

main();
