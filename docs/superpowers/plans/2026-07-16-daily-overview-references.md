# Daily Overview Reference Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add clickable `[n]` reference links to bullet points in the daily overview, so each cited topic links back to the original article/video that supports it.

**Architecture:** `seen_items` gains a `link` column so today's items (from DB + this run) carry their link into the overview prompt. The GitHub Models prompt numbers each item `[1]..[N]` and asks the AI to cite those numbers at the end of relevant bullets. After the AI responds, `index.js` builds a `references` array (same order as the prompt) and `digest.js` escapes the AI text first, then replaces `[n]` with a real `<a href="...">n</a>` tag using that array — in that order, so the injected anchor tags are never re-escaped.

**Tech Stack:** Node.js 24, `node:sqlite`, `node:test` + `node:assert/strict`. No new dependencies.

## Global Constraints

- Scope is the **daily** overview only — the monthly overview is unchanged (spec §1).
- Reference numbering is **global/sequential** by time order (today's DB items, then this run's new items), not per-source (spec §1, §2).
- Render order is strict: `escapeHtml(text)` **first**, then replace `[n]` with `<a href="link">n</a>` on the already-escaped text — never escape after injecting the anchor tags (spec §4).
- An out-of-range citation number, or a citation for an item whose `link` is missing/null (e.g. pre-migration data), must degrade to the literal `[n]` text — never throw, never render a broken link (spec §4).
- `daily_overviews` (stored text) and the monthly-overview pipeline are **not modified** — references are recomputed fresh every run from live DB + in-memory data, never persisted (spec §5).
- Schema changes to existing tables must use the `ensureColumn` migration helper, never rely on `CREATE TABLE IF NOT EXISTS` alone (established project pattern, `src/db.js`).

---

### Task 1: `src/db.js` — add `link` column to `seen_items`

**Files:**
- Modify: `src/db.js` (full file shown below)
- Test: `tests/db.test.js` (full file shown below)

**Interfaces:**
- Consumes: nothing new
- Produces (changed from current state):
  - `markSeen(id, sourceName, title, description, link, seenAt = now)` — **signature changed**, `link` inserted before `seenAt` (was `markSeen(id, sourceName, title, description, seenAt)`)
  - `getTodayItems(sinceTs)` → `{sourceName, title, description, link}[]` — **return shape changed**, now includes `link`
  - All other methods (`isSeen`, `upsertDailyOverview`, `getDailyOverviewsForMonth`, `getMonthlyOverview`, `saveMonthlyOverview`, `markMonthlyOverviewSent`, `close`) unchanged

- [ ] **Step 1: Write the failing test**

Replace `tests/db.test.js` entirely:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDb } from '../src/db.js';

test('isSeen is false for unknown id, true after markSeen', () => {
  const db = createDb(':memory:');
  assert.equal(db.isSeen('item-1'), false);
  db.markSeen('item-1', 'Nguồn A', 'Tiêu đề 1', 'Mô tả 1', 'https://a.example/1', 1720000000);
  assert.equal(db.isSeen('item-1'), true);
  db.close();
});

test('markSeen is idempotent for the same id', () => {
  const db = createDb(':memory:');
  db.markSeen('item-1', 'Nguồn A', 'Tiêu đề 1', 'Mô tả 1', 'https://a.example/1', 1720000000);
  db.markSeen('item-1', 'Nguồn A', 'Tiêu đề 1', 'Mô tả 1', 'https://a.example/1', 1720000001);
  assert.equal(db.isSeen('item-1'), true);
  db.close();
});

test('markSeen defaults seenAt to current unix time', () => {
  const db = createDb(':memory:');
  const before = Math.floor(Date.now() / 1000);
  db.markSeen('item-2', 'Nguồn B', 'Tiêu đề 2', 'Mô tả 2', 'https://a.example/2');
  assert.equal(db.isSeen('item-2'), true);
  assert.ok(before <= Math.floor(Date.now() / 1000));
  db.close();
});

test('getTodayItems returns only items seen at or after the given timestamp, oldest first, including link', () => {
  const db = createDb(':memory:');
  db.markSeen('item-1', 'Nguồn A', 'Tiêu đề 1', 'Mô tả 1', 'https://a.example/1', 1000);
  db.markSeen('item-2', 'Nguồn B', 'Tiêu đề 2', 'Mô tả 2', 'https://a.example/2', 2000);
  db.markSeen('item-3', 'Nguồn C', 'Tiêu đề 3', 'Mô tả 3', 'https://a.example/3', 3000);
  const items = db.getTodayItems(2000);
  assert.deepEqual(items, [
    { sourceName: 'Nguồn B', title: 'Tiêu đề 2', description: 'Mô tả 2', link: 'https://a.example/2' },
    { sourceName: 'Nguồn C', title: 'Tiêu đề 3', description: 'Mô tả 3', link: 'https://a.example/3' },
  ]);
  db.close();
});

test('upsertDailyOverview inserts then overwrites for the same date', () => {
  const db = createDb(':memory:');
  db.upsertDailyOverview('2026-07-16', '• bản đầu', 1000);
  db.upsertDailyOverview('2026-07-16', '• bản cập nhật', 2000);
  const rows = db.getDailyOverviewsForMonth('2026-07');
  assert.deepEqual(rows, [{ date: '2026-07-16', text: '• bản cập nhật' }]);
  db.close();
});

test('getDailyOverviewsForMonth only returns rows within that month, sorted by date', () => {
  const db = createDb(':memory:');
  db.upsertDailyOverview('2026-06-30', '• tháng 6', 1000);
  db.upsertDailyOverview('2026-07-02', '• tháng 7 ngày 2', 1000);
  db.upsertDailyOverview('2026-07-01', '• tháng 7 ngày 1', 1000);
  const rows = db.getDailyOverviewsForMonth('2026-07');
  assert.deepEqual(rows, [
    { date: '2026-07-01', text: '• tháng 7 ngày 1' },
    { date: '2026-07-02', text: '• tháng 7 ngày 2' },
  ]);
  db.close();
});

test('getMonthlyOverview returns undefined when missing, {text, sent:false} after save, {text, sent:true} after markMonthlyOverviewSent', () => {
  const db = createDb(':memory:');
  assert.equal(db.getMonthlyOverview('2026-06'), undefined);
  db.saveMonthlyOverview('2026-06', '• tổng quan tháng 6', 1000);
  assert.deepEqual(db.getMonthlyOverview('2026-06'), { text: '• tổng quan tháng 6', sent: false });
  db.markMonthlyOverviewSent('2026-06');
  assert.deepEqual(db.getMonthlyOverview('2026-06'), { text: '• tổng quan tháng 6', sent: true });
  db.close();
});

test('ensureColumn migration adds the link column to a pre-existing seen_items table without it', () => {
  const dbPath = path.join(os.tmpdir(), `migration-test-link-${Date.now()}.db`);
  const oldDb = new DatabaseSync(dbPath);
  oldDb.exec(
    'CREATE TABLE seen_items (id TEXT PRIMARY KEY, source_name TEXT, seen_at INTEGER, title TEXT, description TEXT)'
  );
  oldDb
    .prepare('INSERT INTO seen_items (id, source_name, seen_at, title, description) VALUES (?, ?, ?, ?, ?)')
    .run('old-item', 'Nguồn cũ', 1000, 'Tiêu đề cũ', 'Mô tả cũ');
  oldDb.close();

  const db = createDb(dbPath);
  const items = db.getTodayItems(500);
  assert.deepEqual(items, [{ sourceName: 'Nguồn cũ', title: 'Tiêu đề cũ', description: 'Mô tả cũ', link: null }]);
  db.close();
  fs.unlinkSync(dbPath);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/db.test.js`
Expected: FAIL — `markSeen`/`getTodayItems` calls have the wrong argument count/shape for the current implementation (extra `link` argument shifts `seenAt`, so timestamps land in the wrong column and assertions on returned `link` fields fail with `undefined` instead of the expected URL).

- [ ] **Step 3: Write minimal implementation**

Replace `src/db.js` entirely:

```js
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function ensureColumn(db, table, column, type) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = columns.some((col) => col.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

export function createDb(dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS seen_items (
      id TEXT PRIMARY KEY,
      source_name TEXT,
      seen_at INTEGER
    )
  `);
  ensureColumn(db, 'seen_items', 'title', 'TEXT');
  ensureColumn(db, 'seen_items', 'description', 'TEXT');
  ensureColumn(db, 'seen_items', 'link', 'TEXT');

  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_overviews (
      date TEXT PRIMARY KEY,
      overview_text TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS monthly_overviews (
      month TEXT PRIMARY KEY,
      overview_text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  ensureColumn(db, 'monthly_overviews', 'sent', 'INTEGER NOT NULL DEFAULT 0');

  const isSeenStmt = db.prepare('SELECT 1 FROM seen_items WHERE id = ?');
  const markSeenStmt = db.prepare(
    'INSERT OR IGNORE INTO seen_items (id, source_name, seen_at, title, description, link) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const getTodayItemsStmt = db.prepare(
    'SELECT source_name AS sourceName, title, description, link FROM seen_items WHERE seen_at >= ? AND title IS NOT NULL ORDER BY seen_at ASC'
  );
  const upsertDailyOverviewStmt = db.prepare(
    'INSERT INTO daily_overviews (date, overview_text, updated_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(date) DO UPDATE SET overview_text = excluded.overview_text, updated_at = excluded.updated_at'
  );
  const getDailyOverviewsForMonthStmt = db.prepare(
    'SELECT date, overview_text AS text FROM daily_overviews WHERE date LIKE ? ORDER BY date ASC'
  );
  const getMonthlyOverviewStmt = db.prepare('SELECT overview_text, sent FROM monthly_overviews WHERE month = ?');
  const saveMonthlyOverviewStmt = db.prepare(
    'INSERT OR REPLACE INTO monthly_overviews (month, overview_text, sent, created_at) VALUES (?, ?, 0, ?)'
  );
  const markMonthlyOverviewSentStmt = db.prepare('UPDATE monthly_overviews SET sent = 1 WHERE month = ?');

  return {
    isSeen(id) {
      return isSeenStmt.get(id) !== undefined;
    },
    markSeen(id, sourceName, title, description, link, seenAt = Math.floor(Date.now() / 1000)) {
      markSeenStmt.run(id, sourceName, seenAt, title, description, link);
    },
    getTodayItems(sinceTs) {
      return getTodayItemsStmt.all(sinceTs).map((obj) => ({ ...obj }));
    },
    upsertDailyOverview(date, text, updatedAt = Math.floor(Date.now() / 1000)) {
      upsertDailyOverviewStmt.run(date, text, updatedAt);
    },
    getDailyOverviewsForMonth(monthKey) {
      return getDailyOverviewsForMonthStmt.all(`${monthKey}-%`).map((obj) => ({ ...obj }));
    },
    getMonthlyOverview(monthKey) {
      const row = getMonthlyOverviewStmt.get(monthKey);
      return row ? { text: row.overview_text, sent: row.sent === 1 } : undefined;
    },
    saveMonthlyOverview(monthKey, text, createdAt = Math.floor(Date.now() / 1000)) {
      saveMonthlyOverviewStmt.run(monthKey, text, createdAt);
    },
    markMonthlyOverviewSent(monthKey) {
      markMonthlyOverviewSentStmt.run(monthKey);
    },
    close() {
      db.close();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/db.test.js`
Expected: PASS (8 tests: 7 existing + 1 new migration-safety test)

- [ ] **Step 5: Commit**

```bash
git add src/db.js tests/db.test.js
git commit -m "feat: store item link in db for daily overview citations"
```

---

### Task 2: `src/overview.js` — numbered citations in the daily prompt

**Files:**
- Modify: `src/overview.js` (full file shown below)
- Test: `tests/overview.test.js` (full file shown below)

**Interfaces:**
- Consumes: nothing new
- Produces (changed from current state):
  - `buildDailyPrompt(items)` — items are still `{sourceName, title, description}` (link is NOT included in the prompt text — the AI only needs to know indices exist, not the URLs), but each line is now prefixed with a 1-based index `[1]`, `[2]`, ... matching array position, and the prompt instructs the AI to append citation numbers (e.g. `[1][3]`) to each bullet
  - `buildMonthlyPrompt`, `createOverviewSummarizer` — **unchanged**

- [ ] **Step 1: Write the failing test**

Replace `tests/overview.test.js` entirely:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyPrompt, buildMonthlyPrompt, createOverviewSummarizer } from '../src/overview.js';

test('buildDailyPrompt lists numbered source/title/description per line and asks for citations', () => {
  const items = [
    { sourceName: 'Vietnamnet', title: 'Giá vàng tăng', description: 'Vàng SJC lên 90 triệu' },
    { sourceName: 'YouTube Kinh tế', title: 'Bản tin chiều', description: '' },
  ];
  const prompt = buildDailyPrompt(items);
  assert.match(prompt, /\[1\] \[Vietnamnet\] Giá vàng tăng: Vàng SJC lên 90 triệu/);
  assert.match(prompt, /\[2\] \[YouTube Kinh tế\] Bản tin chiều\n/);
  assert.match(prompt, /gạch đầu dòng/);
  assert.match(prompt, /số tham chiếu/);
});

test('buildMonthlyPrompt lists each day\'s overview text and the month label', () => {
  const dailyOverviews = [
    { date: '2026-06-01', text: '• Chủ đề A' },
    { date: '2026-06-02', text: '• Chủ đề B' },
  ];
  const prompt = buildMonthlyPrompt(dailyOverviews, '06/2026');
  assert.match(prompt, /2026-06-01:\n• Chủ đề A/);
  assert.match(prompt, /2026-06-02:\n• Chủ đề B/);
  assert.match(prompt, /tháng 06\/2026/);
});

test('summarizeDaily calls chatFn with the numbered prompt and returns its result', async () => {
  let capturedToken;
  let capturedPrompt;
  const fakeChat = async (token, prompt) => {
    capturedToken = token;
    capturedPrompt = prompt;
    return '• Chủ đề A [1]\n• Chủ đề B [1]';
  };
  const summarizer = createOverviewSummarizer('tok', fakeChat);
  const result = await summarizer.summarizeDaily([{ sourceName: 'X', title: 'T', description: '' }]);
  assert.equal(result, '• Chủ đề A [1]\n• Chủ đề B [1]');
  assert.equal(capturedToken, 'tok');
  assert.match(capturedPrompt, /\[1\] \[X\] T/);
});

test('summarizeDaily returns null for empty items without calling chatFn', async () => {
  const summarizer = createOverviewSummarizer('tok', async () => {
    throw new Error('should not be called');
  });
  assert.equal(await summarizer.summarizeDaily([]), null);
});

test('summarizeMonthly returns null for empty dailyOverviews without calling chatFn', async () => {
  const summarizer = createOverviewSummarizer('tok', async () => {
    throw new Error('should not be called');
  });
  assert.equal(await summarizer.summarizeMonthly([], '06/2026'), null);
});

test('summarizeMonthly propagates chatFn errors', async () => {
  const summarizer = createOverviewSummarizer('tok', async () => {
    throw new Error('HTTP 500');
  });
  await assert.rejects(
    () => summarizer.summarizeMonthly([{ date: '2026-06-01', text: 'x' }], '06/2026'),
    /500/
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/overview.test.js`
Expected: FAIL — the current `formatItemLine` output is `- [Vietnamnet] Giá vàng tăng: ...` (no leading `[1]` index, uses `- ` not `[n] `), so the `/\[1\] \[Vietnamnet\].../` and `/số tham chiếu/` assertions don't match.

- [ ] **Step 3: Write minimal implementation**

Replace `src/overview.js` entirely:

```js
import { chatComplete } from './githubModels.js';

function formatItemLine(item, index) {
  const desc = item.description ? `: ${item.description}` : '';
  return `[${index}] [${item.sourceName}] ${item.title}${desc}`;
}

export function buildDailyPrompt(items) {
  const list = items.map((item, i) => formatItemLine(item, i + 1)).join('\n');
  return `Dưới đây là danh sách tin tức trong ngày hôm nay, mỗi dòng có số thứ tự và nguồn:\n${list}\n\nHãy viết tổng quan các chủ đề/xu hướng thời sự nổi bật nhất trong ngày, dưới dạng danh sách gạch đầu dòng (3-7 dòng), bằng tiếng Việt. Nếu một chủ đề được nhiều nguồn khác nhau cùng đề cập, hãy đưa chủ đề đó lên đầu và mô tả rõ hơn vì đó là chủ đề đang được quan tâm nhiều. Cuối mỗi gạch đầu dòng, thêm số thứ tự của các tin liên quan trong ngoặc vuông (ví dụ: [1][3][5]) — dùng đúng số thứ tự đã cho ở trên, không tự đặt số mới. Chỉ trả lời danh sách gạch đầu dòng kèm số tham chiếu, không thêm tiêu đề hay ghi chú khác.`;
}

export function buildMonthlyPrompt(dailyOverviews, monthLabel) {
  const list = dailyOverviews.map((d) => `${d.date}:\n${d.text}`).join('\n\n');
  return `Dưới đây là tổng quan từng ngày trong tháng ${monthLabel}:\n\n${list}\n\nHãy viết tổng quan cả tháng ${monthLabel} dưới dạng danh sách gạch đầu dòng, nêu các chủ đề/sự kiện lớn nổi bật nhất trong tháng, bằng tiếng Việt. Ưu tiên chủ đề xuất hiện lặp lại ở nhiều ngày, đưa lên đầu danh sách. Chỉ trả lời danh sách gạch đầu dòng, không thêm tiêu đề hay ghi chú khác.`;
}

export function createOverviewSummarizer(token, chatFn = chatComplete) {
  return {
    async summarizeDaily(items) {
      if (!items || items.length === 0) return null;
      return chatFn(token, buildDailyPrompt(items));
    },
    async summarizeMonthly(dailyOverviews, monthLabel) {
      if (!dailyOverviews || dailyOverviews.length === 0) return null;
      return chatFn(token, buildMonthlyPrompt(dailyOverviews, monthLabel));
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/overview.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/overview.js tests/overview.test.js
git commit -m "feat: number daily-overview prompt items and request bullet citations"
```

---

### Task 3: `src/digest.js` — linkify citation numbers into real links

**Files:**
- Modify: `src/digest.js` (full file shown below)
- Test: `tests/digest.test.js` (full file shown below)

**Interfaces:**
- Consumes: nothing new
- Produces (changed from current state):
  - `buildDigestText({ items, dailyOverview, monthlyOverviewError, now })` — `dailyOverview` on success can now be `{ text, references }` where `references` is a `string[]` (link at index `n-1` corresponds to citation `[n]`); `references` is optional — if omitted, citation numbers are rendered as literal text (no crash, no broken links)
  - `escapeHtml`, `splitDigestMessages` — **unchanged**
  - New private helper `linkifyReferences(escapedText, references)` (not exported — only used internally by `buildDigestText`)

- [ ] **Step 1: Write the failing test**

Replace `tests/digest.test.js` entirely:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDigestText, splitDigestMessages, escapeHtml } from '../src/digest.js';

test('buildDigestText builds header and one HTML link line per item', () => {
  const items = [
    { title: 'Giá vàng tăng', link: 'https://a.example/1', sourceName: 'Vietnamnet' },
    { title: 'Fed giữ nguyên lãi suất', link: 'https://a.example/2', sourceName: 'Reuters' },
  ];
  const now = new Date(2026, 6, 13); // 13/07 (month is 0-indexed)
  const text = buildDigestText({ items, now });
  assert.equal(
    text,
    [
      '📰 Tổng hợp tin mới (13/07 - 4 tiếng qua)',
      '',
      '• <a href="https://a.example/1">Giá vàng tăng (Vietnamnet)</a>',
      '• <a href="https://a.example/2">Fed giữ nguyên lãi suất (Reuters)</a>',
    ].join('\n')
  );
});

test('buildDigestText HTML-escapes title and source text', () => {
  const items = [{ title: 'A & B <tag>', link: 'https://a.example/1', sourceName: 'X & Y' }];
  const text = buildDigestText({ items, now: new Date(2026, 6, 13) });
  assert.ok(text.includes('A &amp; B &lt;tag&gt; (X &amp; Y)'));
});

test('buildDigestText inserts the daily overview block when present', () => {
  const items = [{ title: 'T', link: 'https://a.example/1', sourceName: 'S' }];
  const text = buildDigestText({
    items,
    dailyOverview: { text: '• Chủ đề A\n• Chủ đề B' },
    now: new Date(2026, 6, 13),
  });
  assert.ok(text.includes('🔎 Tổng quan trong ngày:\n• Chủ đề A\n• Chủ đề B'));
});

test('buildDigestText inserts a warning when the daily overview failed', () => {
  const items = [{ title: 'T', link: 'https://a.example/1', sourceName: 'S' }];
  const text = buildDigestText({ items, dailyOverview: { failed: true }, now: new Date(2026, 6, 13) });
  assert.ok(text.includes('⚠️ Không tạo được tổng quan trong ngày (lỗi API)'));
});

test('buildDigestText inserts a warning when the monthly overview failed', () => {
  const items = [{ title: 'T', link: 'https://a.example/1', sourceName: 'S' }];
  const text = buildDigestText({ items, monthlyOverviewError: true, now: new Date(2026, 6, 13) });
  assert.ok(text.includes('⚠️ Không tạo được tổng quan tháng trước (lỗi API)'));
});

test('buildDigestText linkifies valid citation numbers in the daily overview using references', () => {
  const items = [{ title: 'T', link: 'https://a.example/1', sourceName: 'S' }];
  const text = buildDigestText({
    items,
    dailyOverview: {
      text: '• Chủ đề A [1][2]\n• Chủ đề B [3]',
      references: ['https://ref.example/1', 'https://ref.example/2', 'https://ref.example/3'],
    },
    now: new Date(2026, 6, 13),
  });
  assert.ok(text.includes('• Chủ đề A <a href="https://ref.example/1">1</a><a href="https://ref.example/2">2</a>'));
  assert.ok(text.includes('• Chủ đề B <a href="https://ref.example/3">3</a>'));
});

test('buildDigestText leaves out-of-range or missing-link citations as plain text', () => {
  const items = [{ title: 'T', link: 'https://a.example/1', sourceName: 'S' }];
  const text = buildDigestText({
    items,
    dailyOverview: {
      text: '• Chủ đề A [1][9]',
      references: ['https://ref.example/1'],
    },
    now: new Date(2026, 6, 13),
  });
  assert.ok(text.includes('<a href="https://ref.example/1">1</a>'));
  assert.ok(text.includes('[9]'));
  assert.ok(!text.includes('href="undefined"'));
});

test('buildDigestText escapes overview text before linkifying, so injected anchor tags are not double-escaped', () => {
  const items = [{ title: 'T', link: 'https://a.example/1', sourceName: 'S' }];
  const text = buildDigestText({
    items,
    dailyOverview: {
      text: 'A & B [1]',
      references: ['https://ref.example/1'],
    },
    now: new Date(2026, 6, 13),
  });
  assert.ok(text.includes('A &amp; B <a href="https://ref.example/1">1</a>'));
  assert.ok(!text.includes('&amp;lt;a'));
});

test('buildDigestText renders citation numbers as literal text when references is missing', () => {
  const items = [{ title: 'T', link: 'https://a.example/1', sourceName: 'S' }];
  const text = buildDigestText({
    items,
    dailyOverview: { text: '• Chủ đề A [1]' },
    now: new Date(2026, 6, 13),
  });
  assert.ok(text.includes('• Chủ đề A [1]'));
});

test('splitDigestMessages returns the whole text as one chunk when under the limit', () => {
  const text = 'line1\nline2';
  assert.deepEqual(splitDigestMessages(text, 4096), ['line1\nline2']);
});

test('splitDigestMessages splits on line boundaries without exceeding the limit', () => {
  const text = ['aaaa', 'bbbb', 'cccc'].join('\n'); // each line 4 chars
  const chunks = splitDigestMessages(text, 9); // fits "aaaa\nbbbb" (9 chars) but not a 3rd line
  assert.deepEqual(chunks, ['aaaa\nbbbb', 'cccc']);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 9);
  }
});

test('escapeHtml escapes ampersand, less-than, and greater-than', () => {
  assert.equal(escapeHtml('A & B <tag> C > D'), 'A &amp; B &lt;tag&gt; C &gt; D');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/digest.test.js`
Expected: FAIL — the 3 new citation-linkifying tests fail because `buildDigestText` currently just escapes and inserts the overview text verbatim, with no `[n]` → `<a>` substitution.

- [ ] **Step 3: Write minimal implementation**

Replace `src/digest.js` entirely:

```js
function pad2(n) {
  return String(n).padStart(2, '0');
}

export function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function linkifyReferences(escapedText, references = []) {
  return escapedText.replace(/\[(\d+)\]/g, (match, numStr) => {
    const link = references[Number(numStr) - 1];
    return link ? `<a href="${link}">${numStr}</a>` : match;
  });
}

export function buildDigestText({ items, dailyOverview = null, monthlyOverviewError = false, now = new Date() }) {
  const dateLabel = `${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}`;
  const header = `📰 Tổng hợp tin mới (${dateLabel} - 4 tiếng qua)`;

  const sections = [header];

  if (monthlyOverviewError) {
    sections.push('⚠️ Không tạo được tổng quan tháng trước (lỗi API)');
  }

  if (dailyOverview && dailyOverview.failed) {
    sections.push('⚠️ Không tạo được tổng quan trong ngày (lỗi API)');
  } else if (dailyOverview && dailyOverview.text) {
    const escaped = escapeHtml(dailyOverview.text);
    const linked = linkifyReferences(escaped, dailyOverview.references);
    sections.push(`🔎 Tổng quan trong ngày:\n${linked}`);
  }

  const itemLines = items
    .map((item) => `• <a href="${item.link}">${escapeHtml(item.title)} (${escapeHtml(item.sourceName)})</a>`)
    .join('\n');
  sections.push(itemLines);

  return sections.join('\n\n');
}

export function splitDigestMessages(text, limit = 4096) {
  const lines = text.split('\n');
  const chunks = [];
  let current = '';
  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > limit && current) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/digest.test.js`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add src/digest.js tests/digest.test.js
git commit -m "feat: linkify daily-overview citation numbers into clickable links"
```

---

### Task 4: `index.js` — wire item links into the overview pipeline

**Files:**
- Modify: `index.js` (full file shown below)

**Interfaces:**
- Consumes:
  - `db.markSeen(id, sourceName, title, description, link, seenAt)` (Task 1)
  - `db.getTodayItems(sinceTs)` → `{sourceName, title, description, link}[]` (Task 1)
  - `overviewSummarizer.summarizeDaily(items)` — unchanged signature, still `{sourceName, title, description}[]` in, `string|null` out (`link` is intentionally NOT part of what's sent to the AI — Task 2's prompt only needs indices, not URLs)
  - `buildDigestText({ items, dailyOverview, monthlyOverviewError, now })` where `dailyOverview` can now be `{ text, references }` (Task 3)
- Produces: the running process (no other module depends on `index.js`)

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

  const digestItems = newItems.map((item) => ({ title: item.title, link: item.link, sourceName: item.sourceName }));
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
Expected: all tests across every `tests/*.test.js` file PASS (58 existing + 1 new migration test from Task 1 = 59 total; no test imports `index.js` directly, so this confirms the module-level code didn't break anything it depends on)

- [ ] **Step 4: Manual dry run to confirm the config-error path still works end to end**

Run: `env -i PATH="$PATH" node index.js`
Expected: prints `Thiếu biến môi trường: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, SHEET_CSV_URL, YOUTUBE_API_KEY, GITHUB_TOKEN` and exits with code 1 (verify with `echo $?`)

- [ ] **Step 5: Commit**

```bash
git add index.js
git commit -m "feat: wire item links through the daily overview for citation rendering"
```

---

### Task 5: Full verification pass

**Files:** none (verification only)

**Interfaces:** none

- [ ] **Step 1: Run the complete test suite**

Run: `npm test`
Expected: every test file passes, 59 total tests (58 prior + 1 new migration-safety test), 0 failures

- [ ] **Step 2: Syntax-check the entry point**

Run: `node --check index.js`
Expected: no output

- [ ] **Step 3: Confirm no leftover references to the old function/method signatures**

Run: `grep -rn "formatItemLine(item)\b" --include=*.js . --exclude-dir=node_modules`
Expected: no matches (the old single-argument `formatItemLine(item)` signature from before Task 2 should not appear anywhere)

Run: `grep -rn "markSeen(item.id, item.sourceName, item.title, item.description, seenAt)" --include=*.js . --exclude-dir=node_modules`
Expected: no matches (the old 5-argument `markSeen` call without `link` should not appear anywhere — confirms `index.js` was updated, not just `db.js`)
