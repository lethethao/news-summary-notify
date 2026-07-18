# Schedule Change and 0h Daily Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Narrow the digest schedule to 6h-22h VN time (5 runs/day), and add a separate 0h VN run that sends a Telegram-only summary of yesterday's news (no feed fetching).

**Architecture:** GitHub Actions gets two `schedule` cron entries — one for the digest window, one for 0h — and picks a `RUN_MODE` env var (`digest` vs `daily_summary`) based on which cron fired (`github.event.schedule`). `index.js` branches on `RUN_MODE`: `daily_summary` runs a new `handleDailySummary()` that re-summarizes yesterday's already-`seen` items via a new `db.getItemsInRange()` query, overwrites that day's stored overview, and sends a standalone linkified message; everything else is untouched.

**Tech Stack:** Node.js 24, `node:sqlite`, `node:test` + `node:assert/strict`, GitHub Actions cron. No new dependencies.

## Global Constraints

- Digest runs (fetch + send new items) happen only at **6h, 10h, 14h, 18h, 22h VN time** = **23h, 3h, 7h, 11h, 15h UTC** (spec §2).
- The 0h VN run (= **17h UTC**, previous UTC day) never fetches feeds — it only re-summarizes and sends (spec §2, §4).
- `RUN_MODE` defaults to `'digest'` when unset (local runs, `workflow_dispatch`) — spec §3.
- The 0h summary text is built from `escapeHtml` **then** `linkifyReferences` (already-established order — never linkify before escaping), and does **not** include the per-item detail list (spec §4 step 6).
- `daily_overviews` for yesterday's date gets **overwritten** by the 0h recomputation (spec §4 step 5) — this is intentional, not a bug.
- `handleMonthlyOverview` and everything else in the existing `digest` flow is **unchanged** (spec §6).

---

### Task 1: `src/digest.js` — export `linkifyReferences`

**Files:**
- Modify: `src/digest.js:9` (add `export` keyword only)
- Test: `tests/digest.test.js`

**Interfaces:**
- Consumes: nothing new
- Produces: `linkifyReferences(escapedText, references = [])` — **now exported**, same behavior as before (replaces `[n]` with `<a href="...">n</a>` when `references[n-1]` is truthy, else leaves `[n]` literal)

- [ ] **Step 1: Write the failing test**

Add to `tests/digest.test.js` (update the import line and add one test):

Change the import at the top of the file from:
```js
import { buildDigestText, splitDigestMessages, escapeHtml } from '../src/digest.js';
```
to:
```js
import { buildDigestText, splitDigestMessages, escapeHtml, linkifyReferences } from '../src/digest.js';
```

Add this test anywhere after the existing `escapeHtml` test:
```js
test('linkifyReferences replaces valid citation numbers and leaves invalid ones as literal text', () => {
  const result = linkifyReferences('A [1] B [2] C [9]', ['https://ref.example/1', 'https://ref.example/2']);
  assert.equal(result, 'A <a href="https://ref.example/1">1</a> B <a href="https://ref.example/2">2</a> C [9]');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/digest.test.js`
Expected: FAIL — `linkifyReferences` is not exported from `src/digest.js` (import resolves to `undefined`, calling it throws `TypeError: linkifyReferences is not a function`)

- [ ] **Step 3: Write minimal implementation**

In `src/digest.js`, change:
```js
function linkifyReferences(escapedText, references = []) {
```
to:
```js
export function linkifyReferences(escapedText, references = []) {
```
No other change to the file.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/digest.test.js`
Expected: PASS (15 tests: 14 existing + 1 new)

- [ ] **Step 5: Commit**

```bash
git add src/digest.js tests/digest.test.js
git commit -m "feat: export linkifyReferences for reuse in the 0h daily summary"
```

---

### Task 2: `src/db.js` — `getItemsInRange` query

**Files:**
- Modify: `src/db.js`
- Test: `tests/db.test.js`

**Interfaces:**
- Consumes: nothing new
- Produces: `getItemsInRange(startTs, endTs)` → `{sourceName, title, description, link}[]` — rows with `seen_at >= startTs AND seen_at < endTs AND title IS NOT NULL`, ordered oldest-first (same row shape as `getTodayItems`, but with an explicit upper bound)

- [ ] **Step 1: Write the failing test**

Add to `tests/db.test.js` (anywhere after the existing `getTodayItems` test):

```js
test('getItemsInRange returns only items within [startTs, endTs), oldest first', () => {
  const db = createDb(':memory:');
  db.markSeen('item-1', 'Nguồn A', 'Tiêu đề 1', 'Mô tả 1', 'https://a.example/1', 1000);
  db.markSeen('item-2', 'Nguồn B', 'Tiêu đề 2', 'Mô tả 2', 'https://a.example/2', 2000);
  db.markSeen('item-3', 'Nguồn C', 'Tiêu đề 3', 'Mô tả 3', 'https://a.example/3', 3000);
  db.markSeen('item-4', 'Nguồn D', 'Tiêu đề 4', 'Mô tả 4', 'https://a.example/4', 4000);
  const items = db.getItemsInRange(2000, 4000);
  assert.deepEqual(items, [
    { sourceName: 'Nguồn B', title: 'Tiêu đề 2', description: 'Mô tả 2', link: 'https://a.example/2' },
    { sourceName: 'Nguồn C', title: 'Tiêu đề 3', description: 'Mô tả 3', link: 'https://a.example/3' },
  ]);
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/db.test.js`
Expected: FAIL — `db.getItemsInRange is not a function`

- [ ] **Step 3: Write minimal implementation**

In `src/db.js`, add a new prepared statement right after `getTodayItemsStmt`:

```js
  const getTodayItemsStmt = db.prepare(
    'SELECT source_name AS sourceName, title, description, link FROM seen_items WHERE seen_at >= ? AND title IS NOT NULL ORDER BY seen_at ASC'
  );
  const getItemsInRangeStmt = db.prepare(
    'SELECT source_name AS sourceName, title, description, link FROM seen_items WHERE seen_at >= ? AND seen_at < ? AND title IS NOT NULL ORDER BY seen_at ASC'
  );
```

Then add a matching method to the returned object, right after `getTodayItems`:

```js
    getTodayItems(sinceTs) {
      return getTodayItemsStmt.all(sinceTs).map((obj) => ({ ...obj }));
    },
    getItemsInRange(startTs, endTs) {
      return getItemsInRangeStmt.all(startTs, endTs).map((obj) => ({ ...obj }));
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/db.test.js`
Expected: PASS (9 tests: 8 existing + 1 new)

- [ ] **Step 5: Commit**

```bash
git add src/db.js tests/db.test.js
git commit -m "feat: add getItemsInRange query for the 0h daily summary"
```

---

### Task 3: `index.js` — `RUN_MODE` branching and `handleDailySummary`

**Files:**
- Modify: `index.js` (full file shown below)

**Interfaces:**
- Consumes:
  - `db.getItemsInRange(startTs, endTs)` (Task 2)
  - `linkifyReferences(escapedText, references)` (Task 1), alongside the already-imported `escapeHtml`
  - `startOfDayVN(now)`, `vnDateKey(now)` (existing, `src/time.js`, unchanged)
  - `overviewSummarizer.summarizeDaily(items)` (existing, `src/overview.js`, unchanged — same `{sourceName, title, description}[]` in, `string|null` out contract)
  - `sendDigest(config, text)` (existing, `src/telegram.js`, unchanged)
- Produces: the running process; `RUN_MODE=daily_summary` is the new externally-visible behavior switch read from `process.env.RUN_MODE`

- [ ] **Step 1: Replace `index.js` entirely**

```js
import 'dotenv/config';
import { loadConfig } from './src/config.js';
import { fetchSources } from './src/sources.js';
import { fetchFeed } from './src/feeds.js';
import { fetchYoutubeChannelFeed } from './src/youtubeFeed.js';
import { createDb } from './src/db.js';
import { cleanDescription } from './src/textClean.js';
import { createOverviewSummarizer } from './src/overview.js';
import { buildDigestText, escapeHtml, linkifyReferences } from './src/digest.js';
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

async function handleDailySummary(config, db, overviewSummarizer, now) {
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const startTs = startOfDayVN(yesterday);
  const endTs = startOfDayVN(now);
  const items = db.getItemsInRange(startTs, endTs);
  if (items.length === 0) {
    console.log('Ngày hôm qua không có tin, bỏ qua tóm tắt.');
    return;
  }

  const overviewInput = items.map((item) => ({
    sourceName: item.sourceName,
    title: item.title,
    description: item.description,
    link: item.link,
  }));

  let text;
  try {
    text = await overviewSummarizer.summarizeDaily(overviewInput);
  } catch (err) {
    console.error('Tạo tóm tắt ngày hôm qua lỗi:', err.message);
    return;
  }

  const references = overviewInput.map((item) => item.link);
  const yesterdayKey = vnDateKey(yesterday);
  db.upsertDailyOverview(yesterdayKey, text, Math.floor(Date.now() / 1000));

  const [, month, day] = yesterdayKey.split('-');
  const escaped = escapeHtml(text);
  const linked = linkifyReferences(escaped, references);
  const summaryText = `📆 Tóm tắt ngày hôm qua (${day}/${month})\n\n${linked}`;

  try {
    await sendDigest(config, summaryText);
  } catch (err) {
    console.error('Gửi tóm tắt ngày hôm qua lỗi:', err.message);
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
  const runMode = process.env.RUN_MODE === 'daily_summary' ? 'daily_summary' : 'digest';

  if (runMode === 'daily_summary') {
    await handleDailySummary(config, db, overviewSummarizer, now);
    db.close();
    process.exit(0);
    return;
  }

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
```

- [ ] **Step 2: Syntax-check the file**

Run: `node --check index.js`
Expected: no output (valid syntax)

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all tests pass (65 tests: the pre-existing suite plus the 2 new tests from Tasks 1-2; no test imports `index.js` directly, so this confirms nothing it depends on broke)

- [ ] **Step 4: Manual dry run for both `RUN_MODE` values, confirming the config-error path is unaffected**

Run: `env -i PATH="$PATH" node index.js` (RUN_MODE unset → defaults to `digest`)
Expected: prints `Thiếu biến môi trường: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, SHEET_CSV_URL, YOUTUBE_API_KEY, GITHUB_TOKEN` and exits 1 (check with `echo $?`)

Run: `env -i PATH="$PATH" RUN_MODE=daily_summary node index.js`
Expected: same message and exit code — confirms `loadConfig()` still fails before `RUN_MODE` branching is ever reached, so the config-error path is identical for both modes

- [ ] **Step 5: Commit**

```bash
git add index.js
git commit -m "feat: add 0h daily-summary run mode alongside the digest schedule"
```

---

### Task 4: `.github/workflows/news-digest.yml` and `README.md` — two schedules, `RUN_MODE` env, updated docs

**Files:**
- Modify: `.github/workflows/news-digest.yml`
- Modify: `README.md:3,29`

**Interfaces:**
- Consumes: nothing new
- Produces: nothing new (CI config and docs only)

- [ ] **Step 1: Replace `.github/workflows/news-digest.yml` entirely**

```yaml
name: News digest

on:
  schedule:
    - cron: '0 23,3,7,11,15 * * *'
    - cron: '0 17 * * *'
  workflow_dispatch: {}

permissions:
  contents: write
  models: read

jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '24'

      - name: Restore dedup database from data branch
        run: |
          mkdir -p data
          git fetch origin data 2>/dev/null || true
          if git cat-file -e origin/data:data/app.db 2>/dev/null; then
            git show origin/data:data/app.db > data/app.db
            echo "Đã khôi phục db từ branch data"
          else
            echo "Chưa có db, bắt đầu mới"
          fi

      - run: npm ci

      - run: node index.js
        env:
          RUN_MODE: ${{ github.event.schedule == '0 17 * * *' && 'daily_summary' || 'digest' }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
          SHEET_CSV_URL: ${{ secrets.SHEET_CSV_URL }}
          YOUTUBE_API_KEY: ${{ secrets.YOUTUBE_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Persist dedup database to data branch
        if: always()
        run: |
          if [ ! -f data/app.db ]; then
            echo "Không có db để lưu"
            exit 0
          fi
          cp data/app.db /tmp/app.db
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          if git fetch origin data 2>/dev/null; then
            git checkout -b data origin/data
          else
            git checkout --orphan data
            git reset --hard
          fi
          mkdir -p data
          cp /tmp/app.db data/app.db
          git add -f data/app.db
          if ! git diff --cached --quiet; then
            git commit -m "chore: update dedup db"
            git push origin data
          else
            echo "Db không đổi, bỏ qua commit"
          fi
```

- [ ] **Step 2: Update `README.md`'s two mentions of the old 4-hourly cadence**

In `README.md`, change line 3 from:
```
Tự động lấy tin mới từ RSS/YouTube (danh sách nguồn trong Google Sheet), gửi digest qua Telegram mỗi 4 tiếng kèm tổng quan chủ đề nổi bật trong ngày (và tổng quan cả tháng vào ngày 1 hàng tháng) do GitHub Models tổng hợp.
```
to:
```
Tự động lấy tin mới từ RSS/YouTube (danh sách nguồn trong Google Sheet), gửi digest qua Telegram mỗi 4 tiếng trong khung 6h-22h kèm tổng quan chủ đề nổi bật trong ngày, cộng thêm 1 bản tóm tắt riêng lúc 0h tổng hợp cả ngày hôm qua (và tổng quan cả tháng vào ngày 1 hàng tháng) do GitHub Models tổng hợp.
```

And change line 29 from:
```
Workflow `.github/workflows/news-digest.yml` chạy `node index.js` mỗi 4 tiếng qua `schedule` trigger — không cần server chạy liên tục.
```
to:
```
Workflow `.github/workflows/news-digest.yml` chạy `node index.js` mỗi 4 tiếng trong khung 6h-22h giờ VN, cộng thêm 1 lần chạy riêng lúc 0h giờ VN chỉ để gửi tóm tắt ngày hôm qua (không fetch tin mới) — qua `schedule` trigger, không cần server chạy liên tục.
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/news-digest.yml README.md
git commit -m "ci: run digest 6h-22h VN and add a 0h daily-summary schedule"
```

---

### Task 5: Full verification pass

**Files:** none (verification only)

**Interfaces:** none

- [ ] **Step 1: Run the complete test suite**

Run: `npm test`
Expected: every test file passes, 65 tests total, 0 failures

- [ ] **Step 2: Syntax-check the entry point**

Run: `node --check index.js`
Expected: no output

- [ ] **Step 3: Confirm the cron math is correct**

Run:
```bash
node -e "
const pairs = [['06:00','23'],['10:00','03'],['14:00','07'],['18:00','11'],['22:00','15'],['00:00','17']];
for (const [vn, utc] of pairs) console.log(vn, 'giờ VN ứgn với', utc, 'giờ UTC');
"
```
Expected: prints the 6 VN→UTC pairs listed in spec §2 — manually cross-check each against `.github/workflows/news-digest.yml`'s two cron strings (`0 23,3,7,11,15 * * *` must contain 23,3,7,11,15; the second cron must be `0 17 * * *`)

- [ ] **Step 4: Confirm no stale references to the old single-cron schedule**

Run: `grep -n "0 \*/4" --include=*.yml --include=*.md -r . --exclude-dir=node_modules --exclude-dir=docs`
Expected: no matches (docs are historical specs, intentionally excluded — `README.md` should not mention the old `*/4` cadence anymore if it's referenced there)

Run: `grep -n "0 \*/4" README.md`
Expected: no output (if this finds a match, update `README.md`'s mention of the run cadence to match the new schedule before considering this task done)
