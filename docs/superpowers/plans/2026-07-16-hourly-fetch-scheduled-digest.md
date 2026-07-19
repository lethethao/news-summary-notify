# Hourly Fetch with 3-Mode Scheduled Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the workflow every hour; fetch always happens, but Telegram sends only occur at specific VN-time hours — a link-only list 3x/day and an AI-summarized full-day digest 2x/day.

**Architecture:** `src/time.js` gains a pure `hourVN(now)` helper. `index.js` computes `determineRunMode(now)` from the current VN hour (exported and directly unit-tested, since it's the single highest-risk piece of business logic in this change) and branches into three paths: `fetch_only` (fetch + save, nothing else), `link_digest` (fetch + send a plain title/link list, no AI), `ai_digest` (fetch + re-summarize the whole elapsed period from `src/db.js`'s new `getItemsInRange` + send a full digest). `src/digest.js` and `src/db.js`'s existing `markSeen`/`upsertDailyOverview` are reused unmodified; `buildDigestText` already supports `dailyOverview: null` for the link-only case.

**Tech Stack:** Node.js 24, `node:sqlite`, `node:test` + `node:assert/strict`, GitHub Actions cron. No new dependencies.

## Global Constraints

- Workflow cron becomes a single **`0 * * * *`** (UTC) — runs every hour, no more `RUN_MODE` env var from the workflow YAML (spec §2).
- `markSeen` now runs **immediately after fetch**, not after a successful Telegram send — because most runs (`fetch_only`) never send anything (spec §3 step 4).
- `link_digest` (8h, 16h, 20h VN) sends **only** a title/link list — no AI call, no overview block (spec §5).
- `ai_digest` (12h, 0h VN) re-summarizes the **entire elapsed period from `src/db.js`, not just this run's new items** — 12h uses `[startOfDayVN(now), now)`; 0h uses `[startOfDayVN(yesterday), startOfDayVN(now))` (spec §6). This **intentionally repeats** titles already sent in an earlier `link_digest` the same day.
- Every other hour (19/24) is `fetch_only`: fetch + `markSeen`, nothing else — no AI call, no Telegram send, regardless of whether new items were found (spec §4).
- `handleMonthlyOverview` is unchanged and still runs unconditionally on every invocation (spec §8).

---

### Task 1: `src/time.js` — `hourVN` helper

**Files:**
- Modify: `src/time.js`
- Test: `tests/time.test.js`

**Interfaces:**
- Consumes: nothing new (uses the existing private `toVnDate` helper already in the file)
- Produces: `hourVN(now = new Date())` → integer `0-23`, the hour of day in Vietnam time (UTC+7)

- [ ] **Step 1: Write the failing test**

Add to `tests/time.test.js` (update the import line and add one test):

Change the import at the top of the file from:
```js
import { startOfDayVN, vnDateKey, isFirstDayOfMonthVN, previousMonthKey } from '../src/time.js';
```
to:
```js
import { startOfDayVN, vnDateKey, isFirstDayOfMonthVN, previousMonthKey, hourVN } from '../src/time.js';
```

Add this test anywhere after the existing tests:
```js
test('hourVN returns the hour (0-23) in Vietnam time, rolling over at VN midnight', () => {
  assert.equal(hourVN(new Date('2026-07-16T05:00:00Z')), 12); // 12:00 VN same day
  assert.equal(hourVN(new Date('2026-07-16T16:59:00Z')), 23); // 23:59 VN same day
  assert.equal(hourVN(new Date('2026-07-16T17:00:00Z')), 0);  // 00:00 VN next day
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/time.test.js`
Expected: FAIL — `hourVN is not a function` (import resolves to `undefined`)

- [ ] **Step 3: Write minimal implementation**

In `src/time.js`, add this function anywhere after `toVnDate` is defined (e.g. right after `previousMonthKey`):

```js
export function hourVN(now = new Date()) {
  return toVnDate(now).getUTCHours();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/time.test.js`
Expected: PASS (6 tests: 5 existing + 1 new)

- [ ] **Step 5: Commit**

```bash
git add src/time.js tests/time.test.js
git commit -m "feat: add hourVN helper for VN-time-of-day scheduling logic"
```

---

### Task 2: `src/db.js` — `getItemsInRange` query

**Files:**
- Modify: `src/db.js`
- Test: `tests/db.test.js`

**Interfaces:**
- Consumes: nothing new
- Produces: `getItemsInRange(startTs, endTs)` → `{sourceName, title, description, link}[]` — rows with `seen_at >= startTs AND seen_at < endTs AND title IS NOT NULL`, ordered oldest-first

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
git commit -m "feat: add getItemsInRange query for scheduled full-period digests"
```

---

### Task 3: `index.js` — three-mode orchestration

**Files:**
- Modify: `index.js` (full file shown below)
- Test: `tests/index.test.js` (new)

**Interfaces:**
- Consumes:
  - `hourVN(now)` (Task 1)
  - `db.getItemsInRange(startTs, endTs)` (Task 2)
  - `db.markSeen(id, sourceName, title, description, link, seenAt)`, `db.getMonthlyOverview`, `db.getDailyOverviewsForMonth`, `db.saveMonthlyOverview`, `db.markMonthlyOverviewSent`, `db.isSeen` (existing, `src/db.js`, unchanged)
  - `buildDigestText({ items, dailyOverview, monthlyOverviewError, now })` — `dailyOverview: null` renders title/link items with no overview block (existing, `src/digest.js`, unchanged)
  - `overviewSummarizer.summarizeDaily(items)` (existing, `src/overview.js`, unchanged)
  - `sendDigest(config, text)`, `sendAlert(config, shortDesc, detail)` (existing, `src/telegram.js`, unchanged)
- Produces:
  - `determineRunMode(now)` → `'fetch_only' | 'link_digest' | 'ai_digest'` — **exported for direct unit testing** (the one exception to this project's "no test file for index.js" convention, because this is pure, side-effect-free, and the single highest-risk piece of logic in this change — an off-by-one here silently changes what gets sent to real users)
  - The running process — `main()` now only runs when the file is executed directly (`node index.js`), not when imported by the test file (see the `import.meta.url` guard at the bottom)

- [ ] **Step 1: Write the failing test**

Create `tests/index.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { determineRunMode } from '../index.js';

test('determineRunMode returns ai_digest at 12h and 0h VN', () => {
  assert.equal(determineRunMode(new Date('2026-07-16T05:00:00Z')), 'ai_digest'); // 12:00 VN
  assert.equal(determineRunMode(new Date('2026-07-16T17:00:00Z')), 'ai_digest'); // 00:00 VN
});

test('determineRunMode returns link_digest at 8h, 16h, 20h VN', () => {
  assert.equal(determineRunMode(new Date('2026-07-16T01:00:00Z')), 'link_digest'); // 08:00 VN
  assert.equal(determineRunMode(new Date('2026-07-16T09:00:00Z')), 'link_digest'); // 16:00 VN
  assert.equal(determineRunMode(new Date('2026-07-16T13:00:00Z')), 'link_digest'); // 20:00 VN
});

test('determineRunMode returns fetch_only at all other hours', () => {
  assert.equal(determineRunMode(new Date('2026-07-16T00:00:00Z')), 'fetch_only'); // 07:00 VN
  assert.equal(determineRunMode(new Date('2026-07-16T10:00:00Z')), 'fetch_only'); // 17:00 VN
  assert.equal(determineRunMode(new Date('2026-07-16T16:00:00Z')), 'fetch_only'); // 23:00 VN
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/index.test.js`
Expected: FAIL — either `determineRunMode is not a function`, or (if `main()` isn't guarded yet) the test process hangs/crashes trying to run the real pipeline on import. Both are expected failure modes before Step 3.

- [ ] **Step 3: Replace `index.js` entirely**

```js
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
import { startOfDayVN, vnDateKey, isFirstDayOfMonthVN, previousMonthKey, hourVN } from './src/time.js';

export function determineRunMode(now) {
  const hour = hourVN(now);
  if (hour === 12 || hour === 0) return 'ai_digest';
  if (hour === 8 || hour === 16 || hour === 20) return 'link_digest';
  return 'fetch_only';
}

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

async function fetchNewItems(config, db) {
  const sources = await fetchSources(config.sheetCsvUrl);
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
  return newItems;
}

async function sendLinkDigest(config, newItems, monthlyResult, now) {
  if (newItems.length === 0) {
    console.log('Không có tin mới, bỏ qua gửi (chế độ link_digest).');
    return;
  }
  const digestItems = newItems.map((item) => ({ title: item.title, link: item.link, sourceName: item.sourceName }));
  const digestText = buildDigestText({
    items: digestItems,
    dailyOverview: null,
    monthlyOverviewError: monthlyResult.failed,
    now,
  });
  await sendDigest(config, digestText);
  console.log(`Đã gửi danh sách link với ${newItems.length} tin mới.`);
}

async function sendAiDigest(config, db, overviewSummarizer, monthlyResult, now) {
  let startTs;
  let endTs;
  let overviewDateKey;
  if (hourVN(now) === 12) {
    startTs = startOfDayVN(now);
    endTs = Math.floor(now.getTime() / 1000);
    overviewDateKey = vnDateKey(now);
  } else {
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    startTs = startOfDayVN(yesterday);
    endTs = startOfDayVN(now);
    overviewDateKey = vnDateKey(yesterday);
  }

  const items = db.getItemsInRange(startTs, endTs);
  if (items.length === 0) {
    console.log('Không có tin nào trong khung tổng hợp, bỏ qua gửi (chế độ ai_digest).');
    return;
  }

  const overviewInput = items.map((item) => ({
    sourceName: item.sourceName,
    title: item.title,
    description: item.description,
    link: item.link,
  }));

  let dailyOverview;
  try {
    const text = await overviewSummarizer.summarizeDaily(overviewInput);
    const references = overviewInput.map((item) => item.link);
    dailyOverview = { text, references };
    db.upsertDailyOverview(overviewDateKey, text, Math.floor(Date.now() / 1000));
  } catch (err) {
    console.error('Tạo tổng quan lỗi:', err.message);
    dailyOverview = { failed: true };
  }

  const digestItems = items.map((item, i) => ({
    title: item.title,
    link: item.link,
    sourceName: item.sourceName,
    referenceNumber: dailyOverview.text ? i + 1 : undefined,
  }));
  const digestText = buildDigestText({
    items: digestItems,
    dailyOverview,
    monthlyOverviewError: monthlyResult.failed,
    now,
  });

  await sendDigest(config, digestText);
  console.log(`Đã gửi tổng hợp AI với ${items.length} tin.`);
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

  let newItems;
  try {
    newItems = await fetchNewItems(config, db);
  } catch (err) {
    console.error('Không đọc được Google Sheet:', err.message);
    await sendAlert(config, 'Không đọc được Google Sheet', err.message);
    db.close();
    process.exit(1);
    return;
  }

  const seenAt = Math.floor(Date.now() / 1000);
  for (const item of newItems) {
    db.markSeen(item.id, item.sourceName, item.title, item.description, item.link, seenAt);
  }

  const runMode = determineRunMode(now);

  if (runMode === 'fetch_only') {
    console.log(`Đã fetch ${newItems.length} tin mới (chế độ chỉ fetch, không gửi).`);
    db.close();
    process.exit(0);
    return;
  }

  try {
    if (runMode === 'link_digest') {
      await sendLinkDigest(config, newItems, monthlyResult, now);
    } else {
      await sendAiDigest(config, db, overviewSummarizer, monthlyResult, now);
    }
  } catch (err) {
    console.error('Gửi Telegram thất bại:', err.message);
    db.close();
    process.exit(1);
    return;
  }

  db.close();
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/index.test.js`
Expected: PASS (3 tests) — and importantly, the process exits cleanly (confirms the `import.meta.url` guard correctly prevented `main()` from running during the test import)

- [ ] **Step 5: Syntax-check and run the full suite**

Run: `node --check index.js`
Expected: no output

Run: `npm test`
Expected: all tests pass (68 tests: prior suite + 1 from Task 1 + 1 from Task 2 + 3 from this task)

- [ ] **Step 6: Manual dry run confirming the config-error path still works**

Run: `env -i PATH="$PATH" node index.js`
Expected: prints `Thiếu biến môi trường: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, SHEET_CSV_URL, YOUTUBE_API_KEY, GITHUB_TOKEN` and exits 1 (check with `echo $?`)

- [ ] **Step 7: Commit**

```bash
git add index.js tests/index.test.js
git commit -m "feat: split fetch from send into fetch_only/link_digest/ai_digest modes"
```

---

### Task 4: `.github/workflows/news-digest.yml` and `README.md` — hourly cron, updated docs

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
    - cron: '0 * * * *'
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
Tự động lấy tin mới từ RSS/YouTube (danh sách nguồn trong Google Sheet) mỗi giờ. Gửi danh sách tin mới qua Telegram lúc 8h/16h/20h, và gửi tổng hợp đầy đủ kèm tổng quan chủ đề nổi bật trong ngày (do GitHub Models tổng hợp) lúc 12h và 0h — cộng thêm tổng quan cả tháng vào ngày 1 hàng tháng.
```

And change line 29 from:
```
Workflow `.github/workflows/news-digest.yml` chạy `node index.js` mỗi 4 tiếng qua `schedule` trigger — không cần server chạy liên tục.
```
to:
```
Workflow `.github/workflows/news-digest.yml` chạy `node index.js` mỗi giờ qua `schedule` trigger — không cần server chạy liên tục. Bản thân `index.js` tự quyết định mỗi lần chạy chỉ fetch tin (đa số giờ), gửi danh sách link (8h/16h/20h giờ VN), hay gửi tổng hợp AI đầy đủ (12h/0h giờ VN).
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/news-digest.yml README.md
git commit -m "ci: run every hour and let index.js pick the send mode by VN time"
```

---

### Task 5: Full verification pass

**Files:** none (verification only)

**Interfaces:** none

- [ ] **Step 1: Run the complete test suite**

Run: `npm test`
Expected: every test file passes, 68 tests total, 0 failures

- [ ] **Step 2: Syntax-check the entry point**

Run: `node --check index.js`
Expected: no output

- [ ] **Step 3: Confirm no stale references to the old cron/RUN_MODE design**

Run: `grep -n "RUN_MODE" --include=*.yml --include=*.js -r . --exclude-dir=node_modules`
Expected: no matches (the `RUN_MODE` env-var approach from the earlier, now-superseded design was never implemented in committed code, but this guards against any stray reference)

Run: `grep -n "0 \*/4\|mỗi 4 tiếng" README.md`
Expected: no output (confirms Task 4 Step 2 actually replaced both mentions)

- [ ] **Step 4: Confirm `determineRunMode`'s three branches are exhaustive and non-overlapping**

Run:
```bash
node -e "
import('./index.js').then(({ determineRunMode }) => {
  const counts = { fetch_only: 0, link_digest: 0, ai_digest: 0 };
  for (let h = 0; h < 24; h++) {
    const d = new Date(Date.UTC(2026, 6, 16, (h - 7 + 24) % 24, 0, 0));
    counts[determineRunMode(d)]++;
  }
  console.log(JSON.stringify(counts));
});
"
```
Expected: `{"fetch_only":19,"link_digest":3,"ai_digest":2}` — confirms all 24 VN hours are classified, matching spec §2's table exactly (19 + 3 + 2 = 24)
