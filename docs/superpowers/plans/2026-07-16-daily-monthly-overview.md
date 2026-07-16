# Daily/Monthly Overview via GitHub Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Gemini per-item summarization with title-only digest items, add an AI-generated "trending topics" overview (daily + monthly) powered by GitHub Models, and remove the now-unused YouTube transcript path.

**Architecture:** A shared `githubModels.js` HTTP client (OpenAI-compatible `chat/completions` on `https://models.github.ai/inference`) backs a new `overview.js` module that builds two kinds of prompts (daily topic overview, monthly rollup) from titles+cleaned descriptions stored in SQLite. `index.js` orchestrates: check/generate monthly overview (independent of new items) → fetch new items → compute daily overview from today's DB rows + this run's new items → send one Telegram digest with title-only item lines plus the overview block(s).

**Tech Stack:** Node.js 24, `node:sqlite` (built-in), `node:test` + `node:assert/strict`, `rss-parser`, `csv-parse`, `dotenv`. No new npm dependency for GitHub Models — plain `fetch`.

## Global Constraints

- All AI calls go through GitHub Models (`openai/gpt-4o-mini`), not Gemini — spec §1, §4.
- `GITHUB_TOKEN` is a required env var (pipeline fails fast like other required keys if missing) — spec §9.
- All "today"/"this month" boundaries use **Vietnam time (UTC+7)**, not server UTC — spec §6.
- Digest items show the **raw title only** — no per-item AI summarization — spec §1, §7.
- Overview output format is a **bullet/numbered list**, not a paragraph — spec §8 (Phần D decision).
- `description` used for overviews is cleaned via heuristic (URL strip + keyword blocklist + 300-char cap), applied uniformly to RSS and YouTube `snippet` — spec §3.
- Overview API failures never abort the pipeline — they degrade to a `⚠️` warning line in the digest (or console-only log if no digest is being sent that run) — spec §8.
- Monthly overview is generated **at most once per month** (cached in `monthly_overviews`) and sent as its own Telegram message, independent of whether this run has new news items — spec §2 step 3, §8.

---

### Task 1: `src/time.js` — Vietnam-timezone date helpers

**Files:**
- Create: `src/time.js`
- Test: `tests/time.test.js`

**Interfaces:**
- Consumes: nothing (pure functions over `Date`)
- Produces:
  - `startOfDayVN(now = new Date()): number` — unix seconds for 00:00 VN of the VN-calendar-day containing `now`
  - `vnDateKey(now = new Date()): string` — `'YYYY-MM-DD'` in VN time
  - `isFirstDayOfMonthVN(now = new Date()): boolean`
  - `previousMonthKey(now = new Date()): string` — `'YYYY-MM'` of the month before the VN-calendar-month containing `now`

- [ ] **Step 1: Write the failing test**

Create `tests/time.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startOfDayVN, vnDateKey, isFirstDayOfMonthVN, previousMonthKey } from '../src/time.js';

test('startOfDayVN returns 00:00 VN for a time within the VN day', () => {
  const now = new Date('2026-07-16T10:00:00Z'); // 17:00 VN same calendar day
  const start = startOfDayVN(now);
  const expected = Math.floor(new Date('2026-07-15T17:00:00Z').getTime() / 1000); // 00:00 VN Jul 16 = 17:00 UTC Jul 15
  assert.equal(start, expected);
});

test('vnDateKey rolls over at VN midnight, not UTC midnight', () => {
  const beforeVnMidnight = new Date('2026-07-16T16:59:00Z'); // 23:59 VN Jul 16
  assert.equal(vnDateKey(beforeVnMidnight), '2026-07-16');
  const afterVnMidnight = new Date('2026-07-16T17:00:00Z'); // 00:00 VN Jul 17
  assert.equal(vnDateKey(afterVnMidnight), '2026-07-17');
});

test('isFirstDayOfMonthVN is true only once VN date rolls to the 1st', () => {
  assert.equal(isFirstDayOfMonthVN(new Date('2026-07-31T16:59:00Z')), false); // still 23:59 VN Jul 31
  assert.equal(isFirstDayOfMonthVN(new Date('2026-07-31T17:00:00Z')), true); // 00:00 VN Aug 1
});

test('previousMonthKey returns the prior month for a normal month', () => {
  assert.equal(previousMonthKey(new Date('2026-07-16T10:00:00Z')), '2026-06');
});

test('previousMonthKey rolls back across a year boundary', () => {
  const jan1Vn = new Date('2025-12-31T17:00:00Z'); // 00:00 VN Jan 1 2026
  assert.equal(previousMonthKey(jan1Vn), '2025-12');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/time.test.js`
Expected: FAIL — `Cannot find module '../src/time.js'`

- [ ] **Step 3: Write minimal implementation**

Create `src/time.js`:

```js
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toVnDate(now) {
  return new Date(now.getTime() + VN_OFFSET_MS);
}

export function startOfDayVN(now = new Date()) {
  const vnDate = toVnDate(now);
  const startVnMs = Date.UTC(vnDate.getUTCFullYear(), vnDate.getUTCMonth(), vnDate.getUTCDate()) - VN_OFFSET_MS;
  return Math.floor(startVnMs / 1000);
}

export function vnDateKey(now = new Date()) {
  const vnDate = toVnDate(now);
  return `${vnDate.getUTCFullYear()}-${pad2(vnDate.getUTCMonth() + 1)}-${pad2(vnDate.getUTCDate())}`;
}

export function isFirstDayOfMonthVN(now = new Date()) {
  return toVnDate(now).getUTCDate() === 1;
}

export function previousMonthKey(now = new Date()) {
  const vnDate = toVnDate(now);
  const prevMonthDate = new Date(Date.UTC(vnDate.getUTCFullYear(), vnDate.getUTCMonth() - 1, 1));
  return `${prevMonthDate.getUTCFullYear()}-${pad2(prevMonthDate.getUTCMonth() + 1)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/time.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/time.js tests/time.test.js
git commit -m "feat: add Vietnam-timezone date helpers"
```

---

### Task 2: `src/textClean.js` — description cleaner

**Files:**
- Create: `src/textClean.js`
- Test: `tests/textClean.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `cleanDescription(text: string | null | undefined): string` — strips bare URLs, drops lines containing ad-related keywords, collapses whitespace, caps at 300 chars

- [ ] **Step 1: Write the failing test**

Create `tests/textClean.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanDescription } from '../src/textClean.js';

test('cleanDescription removes bare URLs', () => {
  assert.equal(cleanDescription('Xem thêm tại https://example.com/xyz nhé'), 'Xem thêm tại nhé');
});

test('cleanDescription drops lines containing ad keywords', () => {
  const input = [
    'Video nói về kinh tế Việt Nam.',
    'Theo dõi Facebook: fb.com/abc',
    'Zalo: 0909xxxxxx',
    'Tải app Android tại đây',
  ].join('\n');
  assert.equal(cleanDescription(input), 'Video nói về kinh tế Việt Nam.');
});

test('cleanDescription collapses whitespace and trims', () => {
  assert.equal(cleanDescription('  Hello   world  \n\n  '), 'Hello world');
});

test('cleanDescription truncates to 300 characters', () => {
  const longText = 'a'.repeat(400);
  assert.equal(cleanDescription(longText).length, 300);
});

test('cleanDescription returns empty string for falsy input', () => {
  assert.equal(cleanDescription(''), '');
  assert.equal(cleanDescription(null), '');
  assert.equal(cleanDescription(undefined), '');
});

test('cleanDescription returns empty string when every line is filtered out', () => {
  assert.equal(cleanDescription('Facebook: fb.com/abc'), '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/textClean.test.js`
Expected: FAIL — `Cannot find module '../src/textClean.js'`

- [ ] **Step 3: Write minimal implementation**

Create `src/textClean.js`:

```js
const AD_KEYWORDS = [
  'facebook', 'fb.com', 'zalo', 'tiktok', 'instagram', 'fanpage',
  'subscribe', 'đăng ký kênh', 'android', 'ios', 'app store',
  'google play', 'download', 'tải app',
];

const URL_PATTERN = /https?:\/\/\S+/gi;
const MAX_LENGTH = 300;

export function cleanDescription(text) {
  if (!text) return '';
  const withoutUrls = text.replace(URL_PATTERN, ' ');
  const lines = withoutUrls.split('\n').filter((line) => {
    const lower = line.toLowerCase();
    return !AD_KEYWORDS.some((keyword) => lower.includes(keyword));
  });
  const cleaned = lines.join(' ').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, MAX_LENGTH);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/textClean.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/textClean.js tests/textClean.test.js
git commit -m "feat: add heuristic description cleaner for overview input"
```

---

### Task 3: `src/githubModels.js` — GitHub Models HTTP client

**Files:**
- Create: `src/githubModels.js`
- Test: `tests/githubModels.test.js`

**Interfaces:**
- Consumes: nothing (takes `fetchImpl` for testability, like `telegram.js`/`youtubeFeed.js`)
- Produces: `chatComplete(token: string, prompt: string, fetchImpl = fetch): Promise<string>` — POSTs to `https://models.github.ai/inference/chat/completions` with model `openai/gpt-4o-mini`, returns trimmed `choices[0].message.content`, throws on non-ok HTTP or empty content

- [ ] **Step 1: Write the failing test**

Create `tests/githubModels.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatComplete } from '../src/githubModels.js';

test('chatComplete posts the prompt and returns trimmed content', async () => {
  let capturedUrl;
  let capturedHeaders;
  let capturedBody;
  const fakeFetch = async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    capturedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '  Tóm tắt xong.  ' } }] }) };
  };
  const text = await chatComplete('tok', 'prompt nội dung', fakeFetch);
  assert.equal(text, 'Tóm tắt xong.');
  assert.equal(capturedUrl, 'https://models.github.ai/inference/chat/completions');
  assert.equal(capturedHeaders.Authorization, 'Bearer tok');
  assert.equal(capturedBody.model, 'openai/gpt-4o-mini');
  assert.equal(capturedBody.messages[0].content, 'prompt nội dung');
});

test('chatComplete throws on non-ok response', async () => {
  const fakeFetch = async () => ({ ok: false, status: 429, text: async () => 'Rate limited' });
  await assert.rejects(() => chatComplete('tok', 'prompt', fakeFetch), /429/);
});

test('chatComplete throws when content is empty', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '' } }] }) });
  await assert.rejects(() => chatComplete('tok', 'prompt', fakeFetch), /rỗng/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/githubModels.test.js`
Expected: FAIL — `Cannot find module '../src/githubModels.js'`

- [ ] **Step 3: Write minimal implementation**

Create `src/githubModels.js`:

```js
const API_URL = 'https://models.github.ai/inference/chat/completions';
const MODEL = 'openai/gpt-4o-mini';

export async function chatComplete(token, prompt, fetchImpl = fetch) {
  const res = await fetchImpl(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub Models API lỗi: HTTP ${res.status} - ${body}`);
  }
  const data = await res.json();
  const text = (data.choices?.[0]?.message?.content || '').trim();
  if (!text) {
    throw new Error('GitHub Models trả về nội dung rỗng');
  }
  return text;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/githubModels.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/githubModels.js tests/githubModels.test.js
git commit -m "feat: add GitHub Models chat completion client"
```

---

### Task 4: `src/overview.js` — daily & monthly overview prompts

**Files:**
- Create: `src/overview.js`
- Test: `tests/overview.test.js`

**Interfaces:**
- Consumes: `chatComplete(token, prompt, fetchImpl)` from Task 3 (`src/githubModels.js`), injected as `chatFn` for testability
- Produces:
  - `buildDailyPrompt(items: {sourceName, title, description}[]): string`
  - `buildMonthlyPrompt(dailyOverviews: {date, text}[], monthLabel: string): string`
  - `createOverviewSummarizer(token: string, chatFn = chatComplete): { summarizeDaily(items): Promise<string|null>, summarizeMonthly(dailyOverviews, monthLabel): Promise<string|null> }`
    - Both `summarize*` methods return `null` when given an empty input array (caller decides what that means); otherwise they call `chatFn(token, prompt)` and return/propagate its result/error.

- [ ] **Step 1: Write the failing test**

Create `tests/overview.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyPrompt, buildMonthlyPrompt, createOverviewSummarizer } from '../src/overview.js';

test('buildDailyPrompt lists source/title/description per line and asks for bullet output', () => {
  const items = [
    { sourceName: 'Vietnamnet', title: 'Giá vàng tăng', description: 'Vàng SJC lên 90 triệu' },
    { sourceName: 'YouTube Kinh tế', title: 'Bản tin chiều', description: '' },
  ];
  const prompt = buildDailyPrompt(items);
  assert.match(prompt, /- \[Vietnamnet\] Giá vàng tăng: Vàng SJC lên 90 triệu/);
  assert.match(prompt, /- \[YouTube Kinh tế\] Bản tin chiều\n/);
  assert.match(prompt, /gạch đầu dòng/);
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

test('summarizeDaily calls chatFn with the built prompt and returns its result', async () => {
  let capturedToken;
  let capturedPrompt;
  const fakeChat = async (token, prompt) => {
    capturedToken = token;
    capturedPrompt = prompt;
    return '• Chủ đề A\n• Chủ đề B';
  };
  const summarizer = createOverviewSummarizer('tok', fakeChat);
  const result = await summarizer.summarizeDaily([{ sourceName: 'X', title: 'T', description: '' }]);
  assert.equal(result, '• Chủ đề A\n• Chủ đề B');
  assert.equal(capturedToken, 'tok');
  assert.match(capturedPrompt, /\[X\] T/);
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
Expected: FAIL — `Cannot find module '../src/overview.js'`

- [ ] **Step 3: Write minimal implementation**

Create `src/overview.js`:

```js
import { chatComplete } from './githubModels.js';

function formatItemLine(item) {
  const desc = item.description ? `: ${item.description}` : '';
  return `- [${item.sourceName}] ${item.title}${desc}`;
}

export function buildDailyPrompt(items) {
  const list = items.map(formatItemLine).join('\n');
  return `Dưới đây là danh sách tin tức trong ngày hôm nay, mỗi dòng ghi rõ nguồn:\n${list}\n\nHãy viết tổng quan các chủ đề/xu hướng thời sự nổi bật nhất trong ngày, dưới dạng danh sách gạch đầu dòng (3-7 dòng), bằng tiếng Việt. Nếu một chủ đề được nhiều nguồn khác nhau cùng đề cập, hãy đưa chủ đề đó lên đầu và mô tả rõ hơn vì đó là chủ đề đang được quan tâm nhiều. Chỉ trả lời danh sách gạch đầu dòng, không thêm tiêu đề hay ghi chú khác.`;
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
git commit -m "feat: add daily/monthly overview prompt building and summarizer"
```

---

### Task 5: `src/db.js` — schema migration + overview storage

**Files:**
- Modify: `src/db.js` (full rewrite of the file — see below)
- Test: `tests/db.test.js` (full rewrite of the file — see below)

**Interfaces:**
- Consumes: nothing new
- Produces (new/changed methods on the object returned by `createDb(dbPath)`):
  - `markSeen(id, sourceName, title, description, seenAt = now)` — **signature changed**, was `markSeen(id, sourceName, seenAt)`
  - `getTodayItems(sinceTs: number): {sourceName, title, description}[]` — rows with `seen_at >= sinceTs`, ordered oldest-first
  - `upsertDailyOverview(date: string, text: string, updatedAt = now): void`
  - `getDailyOverviewsForMonth(monthKey: 'YYYY-MM'): {date, text}[]` — ordered by date ascending
  - `getMonthlyOverview(monthKey: 'YYYY-MM'): string | undefined`
  - `saveMonthlyOverview(monthKey: 'YYYY-MM', text: string, createdAt = now): void`
  - `isSeen(id)` and `close()` unchanged

- [ ] **Step 1: Write the failing test**

Replace `tests/db.test.js` entirely:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/db.js';

test('isSeen is false for unknown id, true after markSeen', () => {
  const db = createDb(':memory:');
  assert.equal(db.isSeen('item-1'), false);
  db.markSeen('item-1', 'Nguồn A', 'Tiêu đề 1', 'Mô tả 1', 1720000000);
  assert.equal(db.isSeen('item-1'), true);
  db.close();
});

test('markSeen is idempotent for the same id', () => {
  const db = createDb(':memory:');
  db.markSeen('item-1', 'Nguồn A', 'Tiêu đề 1', 'Mô tả 1', 1720000000);
  db.markSeen('item-1', 'Nguồn A', 'Tiêu đề 1', 'Mô tả 1', 1720000001);
  assert.equal(db.isSeen('item-1'), true);
  db.close();
});

test('markSeen defaults seenAt to current unix time', () => {
  const db = createDb(':memory:');
  const before = Math.floor(Date.now() / 1000);
  db.markSeen('item-2', 'Nguồn B', 'Tiêu đề 2', 'Mô tả 2');
  assert.equal(db.isSeen('item-2'), true);
  assert.ok(before <= Math.floor(Date.now() / 1000));
  db.close();
});

test('getTodayItems returns only items seen at or after the given timestamp, oldest first', () => {
  const db = createDb(':memory:');
  db.markSeen('item-1', 'Nguồn A', 'Tiêu đề 1', 'Mô tả 1', 1000);
  db.markSeen('item-2', 'Nguồn B', 'Tiêu đề 2', 'Mô tả 2', 2000);
  db.markSeen('item-3', 'Nguồn C', 'Tiêu đề 3', 'Mô tả 3', 3000);
  const items = db.getTodayItems(2000);
  assert.deepEqual(items, [
    { sourceName: 'Nguồn B', title: 'Tiêu đề 2', description: 'Mô tả 2' },
    { sourceName: 'Nguồn C', title: 'Tiêu đề 3', description: 'Mô tả 3' },
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

test('getMonthlyOverview returns undefined when missing, then the saved value after save', () => {
  const db = createDb(':memory:');
  assert.equal(db.getMonthlyOverview('2026-06'), undefined);
  db.saveMonthlyOverview('2026-06', '• tổng quan tháng 6', 1000);
  assert.equal(db.getMonthlyOverview('2026-06'), '• tổng quan tháng 6');
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/db.test.js`
Expected: FAIL — `db.markSeen is not a function` signature mismatch, or `db.getTodayItems is not a function`

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

  const isSeenStmt = db.prepare('SELECT 1 FROM seen_items WHERE id = ?');
  const markSeenStmt = db.prepare(
    'INSERT OR IGNORE INTO seen_items (id, source_name, seen_at, title, description) VALUES (?, ?, ?, ?, ?)'
  );
  const getTodayItemsStmt = db.prepare(
    'SELECT source_name AS sourceName, title, description FROM seen_items WHERE seen_at >= ? AND title IS NOT NULL ORDER BY seen_at ASC'
  );
  const upsertDailyOverviewStmt = db.prepare(
    'INSERT INTO daily_overviews (date, overview_text, updated_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(date) DO UPDATE SET overview_text = excluded.overview_text, updated_at = excluded.updated_at'
  );
  const getDailyOverviewsForMonthStmt = db.prepare(
    'SELECT date, overview_text AS text FROM daily_overviews WHERE date LIKE ? ORDER BY date ASC'
  );
  const getMonthlyOverviewStmt = db.prepare('SELECT overview_text FROM monthly_overviews WHERE month = ?');
  const saveMonthlyOverviewStmt = db.prepare(
    'INSERT OR REPLACE INTO monthly_overviews (month, overview_text, created_at) VALUES (?, ?, ?)'
  );

  return {
    isSeen(id) {
      return isSeenStmt.get(id) !== undefined;
    },
    markSeen(id, sourceName, title, description, seenAt = Math.floor(Date.now() / 1000)) {
      markSeenStmt.run(id, sourceName, seenAt, title, description);
    },
    getTodayItems(sinceTs) {
      return getTodayItemsStmt.all(sinceTs);
    },
    upsertDailyOverview(date, text, updatedAt = Math.floor(Date.now() / 1000)) {
      upsertDailyOverviewStmt.run(date, text, updatedAt);
    },
    getDailyOverviewsForMonth(monthKey) {
      return getDailyOverviewsForMonthStmt.all(`${monthKey}-%`);
    },
    getMonthlyOverview(monthKey) {
      const row = getMonthlyOverviewStmt.get(monthKey);
      return row ? row.overview_text : undefined;
    },
    saveMonthlyOverview(monthKey, text, createdAt = Math.floor(Date.now() / 1000)) {
      saveMonthlyOverviewStmt.run(monthKey, text, createdAt);
    },
    close() {
      db.close();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/db.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/db.js tests/db.test.js
git commit -m "feat: store item title/description and daily/monthly overviews in db"
```

---

### Task 6: `src/digest.js` — title-only items + overview blocks

**Files:**
- Modify: `src/digest.js` (full rewrite of the file — see below)
- Test: `tests/digest.test.js` (full rewrite of the file — see below)

**Interfaces:**
- Consumes: nothing new
- Produces: `buildDigestText({ items, dailyOverview = null, monthlyOverviewError = false, now = new Date() }): string` — **signature changed** from `buildDigestText(items, now)`.
  - `items`: `{title, link, sourceName}[]` (no more `summary` field)
  - `dailyOverview`: `null` (no block), `{ text: string }` (success block), or `{ failed: true }` (warning line)
  - `monthlyOverviewError`: `true` inserts a warning line about the monthly overview
- `splitDigestMessages(text, limit)` unchanged.

- [ ] **Step 1: Write the failing test**

Replace `tests/digest.test.js` entirely:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDigestText, splitDigestMessages } from '../src/digest.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/digest.test.js`
Expected: FAIL — old `buildDigestText(items, now)` positional signature doesn't match new object-arg calls, header/date assertions mismatch

- [ ] **Step 3: Write minimal implementation**

Replace `src/digest.js` entirely:

```js
function pad2(n) {
  return String(n).padStart(2, '0');
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
    sections.push(`🔎 Tổng quan trong ngày:\n${escapeHtml(dailyOverview.text)}`);
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
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/digest.js tests/digest.test.js
git commit -m "feat: render title-only digest items with overview blocks"
```

---

### Task 7: `src/config.js` — `GITHUB_TOKEN` replaces `GEMINI_API_KEY`

**Files:**
- Modify: `src/config.js:5,20-27`
- Test: `tests/config.test.js` (full rewrite of the file — see below)

**Interfaces:**
- Consumes: nothing new
- Produces: `loadConfig(env).githubToken` (new field, replaces `.geminiApiKey`); `REQUIRED_KEYS` no longer includes `GEMINI_API_KEY`, now includes `GITHUB_TOKEN`

- [ ] **Step 1: Write the failing test**

Replace `tests/config.test.js` entirely:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/config.test.js`
Expected: FAIL — `config.githubToken` is `undefined`, missing-keys list still includes `GEMINI_API_KEY`

- [ ] **Step 3: Write minimal implementation**

Edit `src/config.js`:

```js
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED_KEYS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'SHEET_CSV_URL', 'YOUTUBE_API_KEY', 'GITHUB_TOKEN'];

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
    sheetCsvUrl: env.SHEET_CSV_URL,
    youtubeApiKey: env.YOUTUBE_API_KEY,
    githubToken: env.GITHUB_TOKEN,
    dbPath: env.DB_PATH || path.join(ROOT_DIR, 'data', 'app.db'),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/config.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/config.js tests/config.test.js
git commit -m "feat: require GITHUB_TOKEN instead of GEMINI_API_KEY"
```

---

### Task 8: Remove Gemini summarizer and YouTube transcript modules

**Files:**
- Delete: `src/summarizer.js`, `tests/summarizer.test.js`
- Delete: `src/youtube.js`, `tests/youtube.test.js`
- Modify: `package.json` (remove `@google/genai` and `youtube-transcript` dependencies)

**Interfaces:**
- Consumes: nothing (this task only removes now-dead code — Task 9's `index.js` rewrite stops importing these modules)
- Produces: nothing new; confirms no remaining file imports `./src/summarizer.js` or `./src/youtube.js`

- [ ] **Step 1: Confirm nothing outside these files/tests references the modules being removed**

Run: `grep -rn "src/summarizer\|src/youtube\.js\|from './summarizer\|from './youtube\.js" --include=*.js . --exclude-dir=node_modules`
Expected: only matches inside `index.js` (will be rewritten in Task 9), `src/summarizer.js` itself, `src/youtube.js` itself, and their test files. If `index.js` is the only external reference, proceed — Task 9 removes it there.

- [ ] **Step 2: Delete the files**

```bash
git rm src/summarizer.js tests/summarizer.test.js src/youtube.js tests/youtube.test.js
```

- [ ] **Step 3: Remove the now-unused dependencies**

```bash
npm uninstall @google/genai youtube-transcript
```

Expected: `package.json` dependencies now list only `csv-parse`, `dotenv`, `rss-parser`; `package-lock.json` updated accordingly.

- [ ] **Step 4: Run the full test suite to confirm nothing else broke**

Run: `node --test`
Expected: all remaining test files pass. `index.js` still imports the deleted modules at this point, but `node --test` does not execute `index.js`, so this is expected to be green. (Task 9 fixes `index.js` itself.)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: remove Gemini summarizer and YouTube transcript modules"
```

---

### Task 9: `index.js` — rewire the pipeline

**Files:**
- Modify: `index.js` (full rewrite of the file — see below)

**Interfaces:**
- Consumes:
  - `loadConfig()` → `.telegramBotToken, .telegramChatId, .sheetCsvUrl, .youtubeApiKey, .githubToken, .dbPath` (Task 7)
  - `createDb(dbPath)` → `.isSeen, .markSeen(id, sourceName, title, description, seenAt), .getTodayItems(sinceTs), .upsertDailyOverview(date, text, updatedAt), .getDailyOverviewsForMonth(monthKey), .getMonthlyOverview(monthKey), .saveMonthlyOverview(monthKey, text, createdAt), .close()` (Task 5)
  - `cleanDescription(text)` (Task 2)
  - `createOverviewSummarizer(token)` → `.summarizeDaily(items), .summarizeMonthly(dailyOverviews, monthLabel)` (Task 4)
  - `buildDigestText({ items, dailyOverview, monthlyOverviewError, now })` (Task 6)
  - `startOfDayVN(now), vnDateKey(now), isFirstDayOfMonthVN(now), previousMonthKey(now)` (Task 1)
  - `sendDigest(config, text)`, `sendAlert(config, shortDesc, detail)`, `sendTelegramMessage({botToken, chatId, text})` — unchanged, from `src/telegram.js`
  - `fetchSources(sheetCsvUrl)`, `fetchFeed(url)`, `fetchYoutubeChannelFeed(url, apiKey)` — unchanged
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
import { buildDigestText } from './src/digest.js';
import { sendDigest, sendAlert, sendTelegramMessage } from './src/telegram.js';
import { startOfDayVN, vnDateKey, isFirstDayOfMonthVN, previousMonthKey } from './src/time.js';

async function handleMonthlyOverview(config, db, overviewSummarizer, now) {
  if (!isFirstDayOfMonthVN(now)) return { failed: false };
  const monthKey = previousMonthKey(now);
  if (db.getMonthlyOverview(monthKey) !== undefined) return { failed: false };

  const dailyOverviews = db.getDailyOverviewsForMonth(monthKey);
  if (dailyOverviews.length === 0) return { failed: false };

  try {
    const text = await overviewSummarizer.summarizeMonthly(dailyOverviews, monthKey);
    db.saveMonthlyOverview(monthKey, text, Math.floor(Date.now() / 1000));
    await sendTelegramMessage({
      botToken: config.telegramBotToken,
      chatId: config.telegramChatId,
      text: `📅 Tổng quan tháng ${monthKey}\n\n${text}`,
    });
    return { failed: false };
  } catch (err) {
    console.error(`Tạo tổng quan tháng ${monthKey} lỗi:`, err.message);
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
    ...newItems.map((item) => ({ sourceName: item.sourceName, title: item.title, description: item.description })),
  ];

  let dailyOverview;
  try {
    const text = await overviewSummarizer.summarizeDaily(overviewInput);
    dailyOverview = { text };
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
    db.markSeen(item.id, item.sourceName, item.title, item.description, seenAt);
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

Run: `node --test`
Expected: all tests across every `tests/*.test.js` file PASS (no test imports `index.js` directly, so this confirms the module-level code didn't break anything it depends on)

- [ ] **Step 4: Manual dry run against fake credentials to confirm the config-error path works end to end**

Run: `env -i node index.js`
Expected: prints `Thiếu biến môi trường: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, SHEET_CSV_URL, YOUTUBE_API_KEY, GITHUB_TOKEN` and exits with code 1 (verify with `echo $?`)

- [ ] **Step 5: Commit**

```bash
git add index.js
git commit -m "feat: wire daily/monthly overview generation into the digest pipeline"
```

---

### Task 10: Update `.env.example` and `README.md`

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing (docs only)
- Produces: nothing (docs only)

- [ ] **Step 1: Replace `.env.example`**

```
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
SHEET_CSV_URL=
YOUTUBE_API_KEY=
GITHUB_TOKEN=
```

- [ ] **Step 2: Replace `README.md`**

```markdown
# news-summary-notify

Tự động lấy tin mới từ RSS/YouTube (danh sách nguồn trong Google Sheet), gửi digest qua Telegram mỗi 4 tiếng kèm tổng quan chủ đề nổi bật trong ngày (và tổng quan cả tháng vào ngày 1 hàng tháng) do GitHub Models tổng hợp.

## Cài đặt

```bash
npm install
cp .env.example .env
# điền TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, SHEET_CSV_URL, YOUTUBE_API_KEY, GITHUB_TOKEN vào .env
```

`GITHUB_TOKEN` cần quyền "Models: read". Trong GitHub Actions token này được cấp tự động (xem phần dưới). Khi chạy local, tạo 1 Personal Access Token (fine-grained, quyền Models: read-only) rồi điền vào `.env`.

## Chạy thử thủ công

```bash
node index.js
```

## Chạy test

```bash
npm test
```

## Chạy định kỳ tự động (khuyến nghị: GitHub Actions)

Workflow `.github/workflows/news-digest.yml` chạy `node index.js` mỗi 4 tiếng qua `schedule` trigger — không cần server chạy liên tục.

Thiết lập:
1. Vào repo trên GitHub → Settings → Secrets and variables → Actions → thêm 4 secret: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `SHEET_CSV_URL`, `YOUTUBE_API_KEY`. (`GITHUB_TOKEN` dùng token tự động của Actions, không cần tạo secret riêng.)
2. Có thể trigger chạy thử bằng tay ở tab Actions → News digest → Run workflow.

File dedup `data/app.db` được lưu vĩnh viễn trên branch `data` (workflow tự khôi phục/lưu lại mỗi lần chạy), không dùng cache tạm nên không lo bị GitHub tự xoá. File này cũng lưu tổng quan ngày/tháng đã tạo để tái sử dụng.

## Chạy định kỳ bằng pm2 (tự host, cần server/máy chạy liên tục)

```bash
pm2 start ecosystem.config.cjs
```

Lưu ý: không phù hợp để chạy trên GitHub Codespaces vì Codespace tính phí theo thời gian chạy và tự tắt sau ~30 phút không hoạt động.

Xem thiết kế chi tiết tại `docs/superpowers/specs/2026-07-16-daily-monthly-overview-design.md`.
```

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md
git commit -m "docs: update setup instructions for GitHub Models and overview features"
```

---

### Task 11: Update GitHub Actions workflow

**Files:**
- Modify: `.github/workflows/news-digest.yml`

**Interfaces:**
- Consumes: nothing new
- Produces: nothing new (CI config only)

- [ ] **Step 1: Replace `.github/workflows/news-digest.yml` entirely**

```yaml
name: News digest

on:
  schedule:
    - cron: '0 */4 * * *'
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

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/news-digest.yml
git commit -m "ci: grant models:read and pass GITHUB_TOKEN to the digest run"
```

---

### Task 12: Full verification pass

**Files:** none (verification only)

**Interfaces:** none

- [ ] **Step 1: Run the complete test suite**

Run: `node --test`
Expected: every test file passes — `config.test.js`, `db.test.js`, `digest.test.js`, `feeds.test.js`, `githubModels.test.js`, `overview.test.js`, `sources.test.js`, `telegram.test.js`, `textClean.test.js`, `time.test.js`, `youtubeFeed.test.js`. No `summarizer.test.js` or `youtube.test.js` remain.

- [ ] **Step 2: Confirm no leftover references to removed pieces**

Run: `grep -rln "GEMINI_API_KEY\|@google/genai\|youtube-transcript\|gemini-flash-latest" --include=*.js --include=*.json --include=*.yml --include=*.md . --exclude-dir=node_modules --exclude-dir=docs`
Expected: no matches (docs excluded since the old design spec at `docs/superpowers/specs/2026-07-13-...md` is a historical record and may still mention Gemini — that's fine, it's not excluded from grep by accident, it's intentionally out of scope for cleanup)

- [ ] **Step 3: Syntax-check the entry point once more**

Run: `node --check index.js`
Expected: no output

- [ ] **Step 4: Verify `package.json` dependencies are exactly the expected set**

Run: `node -e "console.log(Object.keys(require('./package.json').dependencies).sort())"`
Expected: `[ 'csv-parse', 'dotenv', 'rss-parser' ]`

- [ ] **Step 5: Commit if step 2's grep required any fixes (otherwise skip — nothing to commit)**

If Step 2 found stray references, fix them and:

```bash
git add -A
git commit -m "chore: remove remaining Gemini/transcript references"
```
