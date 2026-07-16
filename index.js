import 'dotenv/config';
import { loadConfig } from './src/config.js';
import { fetchSources } from './src/sources.js';
import { fetchFeed } from './src/feeds.js';
import { fetchYoutubeChannelFeed } from './src/youtubeFeed.js';
import { createDb } from './src/db.js';
import { cleanDescription } from './src/textClean.js';
import { createOverviewSummarizer } from './src/overview.js';
import { buildDigestText, escapeHtml } from './src/digest.js';
import { sendDigest, sendAlert } from './src/telegram.js';
import { startOfDayVN, vnDateKey, isFirstDayOfMonthVN, previousMonthKey } from './src/time.js';

async function handleMonthlyOverview(config, db, overviewSummarizer, now) {
  if (!isFirstDayOfMonthVN(now)) return { failed: false };
  const monthKey = previousMonthKey(now);
  const existing = db.getMonthlyOverview(monthKey);
  if (existing && existing.sent) return { failed: false };

  let text = existing ? existing.text : null;
  if (!text) {
    const dailyOverviews = db.getDailyOverviewsForMonth(monthKey);
    if (dailyOverviews.length === 0) return { failed: false };
    try {
      text = await overviewSummarizer.summarizeMonthly(dailyOverviews, monthKey);
    } catch (err) {
      console.error(`Tạo tổng quan tháng ${monthKey} lỗi:`, err.message);
      return { failed: true };
    }
    db.saveMonthlyOverview(monthKey, text, Math.floor(Date.now() / 1000));
  }

  try {
    const monthLabel = monthKey.replace(/^(\d{4})-(\d{2})$/, '$2/$1');
    const monthlyText = `📅 Tổng quan tháng ${monthLabel}\n\n${escapeHtml(text)}`;
    await sendDigest(config, monthlyText);
    db.markMonthlyOverviewSent(monthKey);
    return { failed: false };
  } catch (err) {
    console.error(`Gửi tổng quan tháng ${monthKey} lỗi:`, err.message);
    return { failed: true };
  }
}

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

  const db = createDb(config.dbPath);
  const overviewSummarizer = createOverviewSummarizer(config.githubToken);
  const now = new Date();

  const monthlyResult = await handleMonthlyOverview(config, db, overviewSummarizer, now);

  let sources;
  try {
    sources = await fetchSources(config.sheetCsvUrl);
  } catch (err) {
    console.error('Không đọc được Google Sheet:', err.message);
    await sendAlert(config, 'Không đọc được Google Sheet', err.message);
    db.close();
    process.exit(1);
    return;
  }

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
      newItems.push({
        ...item,
        sourceName: source.name,
        sourceType: source.type,
        description: cleanDescription(item.snippet),
      });
    }
  }

  if (newItems.length === 0) {
    console.log('Không có tin mới.');
    db.close();
    process.exit(0);
    return;
  }

  const todayItems = db.getTodayItems(startOfDayVN(now));
  const overviewInput = [
    ...todayItems,
    ...newItems.map((item) => ({
      sourceName: item.sourceName,
      title: item.title,
      description: item.description,
      link: item.link,
    })),
  ];

  let dailyOverview;
  try {
    const text = await overviewSummarizer.summarizeDaily(overviewInput);
    const references = overviewInput.map((item) => item.link);
    dailyOverview = { text, references };
    db.upsertDailyOverview(vnDateKey(now), text, Math.floor(Date.now() / 1000));
  } catch (err) {
    console.error('Tạo tổng quan trong ngày lỗi:', err.message);
    dailyOverview = { failed: true };
  }

  const referenceOffset = todayItems.length;
  const digestItems = newItems.map((item, i) => ({
    title: item.title,
    link: item.link,
    sourceName: item.sourceName,
    referenceNumber: dailyOverview.text ? referenceOffset + i + 1 : undefined,
  }));
  const digestText = buildDigestText({
    items: digestItems,
    dailyOverview,
    monthlyOverviewError: monthlyResult.failed,
    now,
  });

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
    db.markSeen(item.id, item.sourceName, item.title, item.description, item.link, seenAt);
  }
  db.close();
  console.log(`Đã gửi digest với ${newItems.length} tin mới.`);
  process.exit(0);
}

main();
