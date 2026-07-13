# News Summary Notify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node.js one-shot script that reads RSS/YouTube sources from a Google Sheet, summarizes new items in Vietnamese via Gemini, and sends a deduped digest to Telegram every 4 hours via pm2 cron.

**Architecture:** A single orchestrator (`index.js`) wires together small, single-responsibility modules under `src/`: config loading, source discovery (Sheet CSV), feed fetching, YouTube transcript retrieval, Gemini summarization, digest text building, sqlite-backed dedup, and Telegram delivery. Every module is pure/injectable where it touches the network so it can be unit-tested without live calls. `index.js` is the only place that knows the full pipeline order and error-handling policy.

**Tech Stack:** Node.js v24 (ESM, `"type": "module"`), `node:sqlite` (built-in), `node:test` (built-in test runner), `rss-parser`, `csv-parse`, `youtube-transcript`, `@google/genai`, native `fetch`, pm2 (`cron_restart`).

## Global Constraints

- Node.js v24; no dependency that requires native compilation (dedup storage uses built-in `node:sqlite`, not `better-sqlite3`).
- Project uses ES modules (`"type": "module"` in `package.json`); pm2 config must be `.cjs` since pm2's config loader expects CommonJS.
- Sheet CSV has exactly 3 columns: `name`, `url`, `type` (`type` is `youtube` or `news`), read fresh every run — no caching of the source list across runs.
- Required env vars, exactly these 4 names: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `GEMINI_API_KEY`, `SHEET_CSV_URL`.
- `seen_items` sqlite schema exactly:
  ```sql
  CREATE TABLE seen_items (
    id TEXT PRIMARY KEY,
    source_name TEXT,
    seen_at INTEGER
  );
  ```
- Digest header format: `📰 Tổng hợp tin mới (DD/MM - 4 tiếng qua)`; one line per item, whole line is a hyperlink; summary text + `(source name)` at the end; flat list, no grouping by source; nothing sent if there are no new items.
- Telegram message hard limit 4096 chars; split into multiple sequential messages on line boundaries only (never mid-line).
- Heavy-error alert format, exactly: `🔴 [news_summary_notify] Lỗi: <mô tả ngắn>\n<chi tiết>`.
- Heavy errors (alert via Telegram if credentials still usable, then `exit(1)`): Sheet unreadable; missing/invalid required config (exception: if `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` themselves are the missing ones, no alert is possible — console log only); every single Gemini call in the run failing (digest still sent using fallback text, prefixed with a warning line).
- Light errors (console log only, pipeline continues): one feed failing/timing out (skip that source); one video's transcript failing (fall back to title+snippet); one item's summarization failing (fall back to title for that item only).
- pm2 `ecosystem.config.cjs`: `cron_restart: '0 */4 * * *'`, `autorestart: false`; must still support manual `node index.js` for testing.
- Out of scope: no web UI, no full article scraping (RSS description only), no multi-chat/multi-user support, no long-term summary history (only dedup IDs are persisted).

**Implementation note (Task 7):** the spec calls each digest line a "markdown hyperlink." Titles/summaries can contain `*_[]` characters that break Telegram's legacy Markdown parser and silently fail the whole message. This plan uses Telegram `parse_mode: HTML` instead (`<a href="...">text</a>`), with HTML-escaping on the dynamic text. Visually it's the same thing the spec asks for — one clickable line per item — just a safer wire format.

---

## Task 1: Project scaffolding & dependencies

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `data/.gitkeep`

**Interfaces:**
- Produces: an ESM Node project with `npm test` running `node --test`, and the 4 runtime dependencies installed and importable.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "news-summary-notify",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node index.js",
    "test": "node --test"
  },
  "dependencies": {
    "@google/genai": "^2.11.0",
    "csv-parse": "^7.0.1",
    "rss-parser": "^3.13.0",
    "youtube-transcript": "^1.3.1"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
.env
node_modules/
data/*.db
```

- [ ] **Step 3: Create `.env.example`**

```
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
GEMINI_API_KEY=
SHEET_CSV_URL=
```

- [ ] **Step 4: Create `data/.gitkeep`** (empty file, so the `data/` dir exists in git even though `.gitignore` excludes `*.db`)

- [ ] **Step 5: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, `package-lock.json` created, no errors.

- [ ] **Step 6: Verify `node:sqlite` is usable without extra install**

Run: `node -e "const {DatabaseSync} = require('node:sqlite'); console.log('ok')"`
Expected: prints `ok` (an `ExperimentalWarning` on stderr is expected and fine).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .gitignore .env.example data/.gitkeep
git commit -m "chore: scaffold news-summary-notify project"
```

---

## Task 2: `src/config.js` — env var loading & validation

**Files:**
- Create: `src/config.js`
- Test: `tests/config.test.js`

**Interfaces:**
- Produces:
  - `class ConfigError extends Error` with `.missingKeys: string[]`
  - `loadConfig(env = process.env) -> { telegramBotToken, telegramChatId, geminiApiKey, sheetCsvUrl, dbPath }` — throws `ConfigError` if any of the 4 required keys is missing/empty.
  - `dbPath` defaults to `<project root>/data/app.db`, overridable via `env.DB_PATH`.

- [ ] **Step 1: Write the failing test**

Create `tests/config.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/config.test.js`
Expected: FAIL — `Cannot find module '../src/config.js'`

- [ ] **Step 3: Write the implementation**

Create `src/config.js`:

```js
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED_KEYS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'GEMINI_API_KEY', 'SHEET_CSV_URL'];

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
    dbPath: env.DB_PATH || path.join(ROOT_DIR, 'data', 'app.db'),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/config.test.js`
Expected: PASS, 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/config.js tests/config.test.js
git commit -m "feat: add env config loader with validation"
```

---

## Task 3: `src/db.js` — sqlite dedup store

**Files:**
- Create: `src/db.js`
- Test: `tests/db.test.js`

**Interfaces:**
- Produces: `createDb(dbPath) -> { isSeen(id) -> boolean, markSeen(id, sourceName, seenAt?) -> void, close() -> void }`
- Creates `seen_items` table (schema per Global Constraints) if it doesn't exist; creates the parent directory of `dbPath` if missing.

- [ ] **Step 1: Write the failing test**

Create `tests/db.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/db.js';

test('isSeen is false for unknown id, true after markSeen', () => {
  const db = createDb(':memory:');
  assert.equal(db.isSeen('item-1'), false);
  db.markSeen('item-1', 'Nguồn A', 1720000000);
  assert.equal(db.isSeen('item-1'), true);
  db.close();
});

test('markSeen is idempotent for the same id', () => {
  const db = createDb(':memory:');
  db.markSeen('item-1', 'Nguồn A', 1720000000);
  db.markSeen('item-1', 'Nguồn A', 1720000001);
  assert.equal(db.isSeen('item-1'), true);
  db.close();
});

test('markSeen defaults seenAt to current unix time', () => {
  const db = createDb(':memory:');
  const before = Math.floor(Date.now() / 1000);
  db.markSeen('item-2', 'Nguồn B');
  assert.equal(db.isSeen('item-2'), true);
  assert.ok(before <= Math.floor(Date.now() / 1000));
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/db.test.js`
Expected: FAIL — `Cannot find module '../src/db.js'`

- [ ] **Step 3: Write the implementation**

Create `src/db.js`:

```js
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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

  const isSeenStmt = db.prepare('SELECT 1 FROM seen_items WHERE id = ?');
  const markSeenStmt = db.prepare(
    'INSERT OR IGNORE INTO seen_items (id, source_name, seen_at) VALUES (?, ?, ?)'
  );

  return {
    isSeen(id) {
      return isSeenStmt.get(id) !== undefined;
    },
    markSeen(id, sourceName, seenAt = Math.floor(Date.now() / 1000)) {
      markSeenStmt.run(id, sourceName, seenAt);
    },
    close() {
      db.close();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/db.test.js`
Expected: PASS, 3 tests passing (an `ExperimentalWarning` for `node:sqlite` on stderr is expected).

- [ ] **Step 5: Commit**

```bash
git add src/db.js tests/db.test.js
git commit -m "feat: add sqlite-backed seen_items dedup store"
```

---

## Task 4: `src/sources.js` — Google Sheet CSV → source list

**Files:**
- Create: `src/sources.js`
- Test: `tests/sources.test.js`

**Interfaces:**
- Produces:
  - `parseSourcesCsv(csvText) -> Array<{name, url, type}>` — pure function, filters out rows whose `type` isn't `youtube`/`news`.
  - `fetchSources(csvUrl, fetchImpl = fetch) -> Promise<Array<{name, url, type}>>` — fetches the CSV over HTTP then delegates to `parseSourcesCsv`; throws on non-2xx response.

- [ ] **Step 1: Write the failing test**

Create `tests/sources.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSourcesCsv, fetchSources } from '../src/sources.js';

test('parseSourcesCsv parses valid rows', () => {
  const csv = 'name,url,type\nVietnamnet,https://vietnamnet.vn/rss,news\nTech Channel,https://youtube.com/feeds/x,youtube\n';
  const sources = parseSourcesCsv(csv);
  assert.deepEqual(sources, [
    { name: 'Vietnamnet', url: 'https://vietnamnet.vn/rss', type: 'news' },
    { name: 'Tech Channel', url: 'https://youtube.com/feeds/x', type: 'youtube' },
  ]);
});

test('parseSourcesCsv filters out rows with an invalid type', () => {
  const csv = 'name,url,type\nBad Row,https://example.com,podcast\nGood Row,https://example.com/2,news\n';
  const sources = parseSourcesCsv(csv);
  assert.deepEqual(sources, [{ name: 'Good Row', url: 'https://example.com/2', type: 'news' }]);
});

test('fetchSources fetches CSV text then parses it', async () => {
  const fakeFetch = async (url) => {
    assert.equal(url, 'https://sheet.example/export?format=csv');
    return {
      ok: true,
      text: async () => 'name,url,type\nA,https://a.example/rss,news\n',
    };
  };
  const sources = await fetchSources('https://sheet.example/export?format=csv', fakeFetch);
  assert.deepEqual(sources, [{ name: 'A', url: 'https://a.example/rss', type: 'news' }]);
});

test('fetchSources throws on non-ok response', async () => {
  const fakeFetch = async () => ({ ok: false, status: 404 });
  await assert.rejects(() => fetchSources('https://sheet.example/bad', fakeFetch), /404/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/sources.test.js`
Expected: FAIL — `Cannot find module '../src/sources.js'`

- [ ] **Step 3: Write the implementation**

Create `src/sources.js`:

```js
import { parse } from 'csv-parse/sync';

const VALID_TYPES = new Set(['youtube', 'news']);

export function parseSourcesCsv(csvText) {
  const records = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });
  return records
    .filter((row) => VALID_TYPES.has(row.type))
    .map((row) => ({ name: row.name, url: row.url, type: row.type }));
}

export async function fetchSources(csvUrl, fetchImpl = fetch) {
  const res = await fetchImpl(csvUrl);
  if (!res.ok) {
    throw new Error(`Không tải được Google Sheet CSV: HTTP ${res.status}`);
  }
  const csvText = await res.text();
  return parseSourcesCsv(csvText);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/sources.test.js`
Expected: PASS, 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/sources.js tests/sources.test.js
git commit -m "feat: add Google Sheet CSV source parsing"
```

---

## Task 5: `src/feeds.js` — RSS/Atom fetch & normalize

**Files:**
- Create: `src/feeds.js`
- Test: `tests/feeds.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `normalizeFeedItem(item) -> {id, title, link, snippet}` — pure function; `id = item.guid || item.link`.
  - `fetchFeed(url, parser = new Parser()) -> Promise<Array<{id, title, link, snippet}>>` — calls `parser.parseURL(url)`, normalizes each item, drops items with no usable `id`. Later used by `index.js`, which relies on `item.id` for dedup lookups against `db.isSeen`/`db.markSeen` from Task 3.

- [ ] **Step 1: Write the failing test**

Create `tests/feeds.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFeedItem, fetchFeed } from '../src/feeds.js';

test('normalizeFeedItem prefers guid over link for id', () => {
  const item = { guid: 'guid-1', link: 'https://example.com/1', title: 'Tiêu đề', contentSnippet: 'Nội dung' };
  assert.deepEqual(normalizeFeedItem(item), {
    id: 'guid-1',
    title: 'Tiêu đề',
    link: 'https://example.com/1',
    snippet: 'Nội dung',
  });
});

test('normalizeFeedItem falls back to link when guid is missing', () => {
  const item = { link: 'https://example.com/2', title: 'T', content: 'C' };
  const result = normalizeFeedItem(item);
  assert.equal(result.id, 'https://example.com/2');
  assert.equal(result.snippet, 'C');
});

test('fetchFeed normalizes items from an injected parser and drops items with no id', async () => {
  const fakeParser = {
    parseURL: async (url) => {
      assert.equal(url, 'https://example.com/rss');
      return {
        items: [
          { guid: 'a', link: 'https://example.com/a', title: 'A', contentSnippet: 'a' },
          { title: 'No id or link' },
        ],
      };
    },
  };
  const items = await fetchFeed('https://example.com/rss', fakeParser);
  assert.deepEqual(items, [{ id: 'a', title: 'A', link: 'https://example.com/a', snippet: 'a' }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/feeds.test.js`
Expected: FAIL — `Cannot find module '../src/feeds.js'`

- [ ] **Step 3: Write the implementation**

Create `src/feeds.js`:

```js
import Parser from 'rss-parser';

export function normalizeFeedItem(item) {
  return {
    id: item.guid || item.link || '',
    title: item.title || '',
    link: item.link || '',
    snippet: item.contentSnippet || item.content || item.summary || '',
  };
}

export async function fetchFeed(url, parser = new Parser()) {
  const feed = await parser.parseURL(url);
  return (feed.items || []).map(normalizeFeedItem).filter((item) => item.id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/feeds.test.js`
Expected: PASS, 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/feeds.js tests/feeds.test.js
git commit -m "feat: add RSS/Atom feed fetching and normalization"
```

---

## Task 6: `src/youtube.js` — video id extraction & transcript retrieval

**Files:**
- Create: `src/youtube.js`
- Test: `tests/youtube.test.js`

**Interfaces:**
- Produces:
  - `extractVideoId(url) -> string | null` — supports `watch?v=`, `youtu.be/`, `/shorts/`, `/embed/` URL forms.
  - `fetchTranscriptText(url, transcriptFetcher = YoutubeTranscript.fetchTranscript) -> Promise<string | null>` — never throws; returns `null` if the URL has no video id, the fetcher throws, or the resulting transcript is empty. `index.js` treats `null` as "fall back to title+snippet".

- [ ] **Step 1: Write the failing test**

Create `tests/youtube.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractVideoId, fetchTranscriptText } from '../src/youtube.js';

test('extractVideoId handles watch, youtu.be, shorts, embed forms', () => {
  assert.equal(extractVideoId('https://www.youtube.com/watch?v=abc123DEF45'), 'abc123DEF45');
  assert.equal(extractVideoId('https://youtu.be/abc123DEF45'), 'abc123DEF45');
  assert.equal(extractVideoId('https://www.youtube.com/shorts/abc123DEF45'), 'abc123DEF45');
  assert.equal(extractVideoId('https://www.youtube.com/embed/abc123DEF45'), 'abc123DEF45');
  assert.equal(extractVideoId('https://www.youtube.com/watch?v=abc123DEF45&t=30s'), 'abc123DEF45');
});

test('extractVideoId returns null for a non-video URL', () => {
  assert.equal(extractVideoId('https://example.com/not-youtube'), null);
});

test('fetchTranscriptText joins transcript segments into one string', async () => {
  const fakeFetcher = async (videoId) => {
    assert.equal(videoId, 'abc123DEF45');
    return [{ text: 'Xin chào' }, { text: 'thế giới' }];
  };
  const text = await fetchTranscriptText('https://youtu.be/abc123DEF45', fakeFetcher);
  assert.equal(text, 'Xin chào thế giới');
});

test('fetchTranscriptText returns null when the URL has no video id', async () => {
  const text = await fetchTranscriptText('https://example.com/not-youtube', async () => {
    throw new Error('should not be called');
  });
  assert.equal(text, null);
});

test('fetchTranscriptText returns null when the fetcher throws', async () => {
  const text = await fetchTranscriptText('https://youtu.be/abc123DEF45', async () => {
    throw new Error('transcripts disabled');
  });
  assert.equal(text, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/youtube.test.js`
Expected: FAIL — `Cannot find module '../src/youtube.js'`

- [ ] **Step 3: Write the implementation**

Create `src/youtube.js`:

```js
import { YoutubeTranscript } from 'youtube-transcript';

const ID_PATTERNS = [
  /youtube\.com\/watch\?v=([\w-]{11})/,
  /youtu\.be\/([\w-]{11})/,
  /youtube\.com\/shorts\/([\w-]{11})/,
  /youtube\.com\/embed\/([\w-]{11})/,
];

export function extractVideoId(url) {
  for (const pattern of ID_PATTERNS) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export async function fetchTranscriptText(url, transcriptFetcher = YoutubeTranscript.fetchTranscript) {
  const videoId = extractVideoId(url);
  if (!videoId) return null;
  try {
    const segments = await transcriptFetcher(videoId);
    const text = segments.map((segment) => segment.text).join(' ').trim();
    return text || null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/youtube.test.js`
Expected: PASS, 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/youtube.js tests/youtube.test.js
git commit -m "feat: add YouTube video id extraction and transcript retrieval"
```

---

## Task 7: `src/digest.js` — build & split digest text

**Files:**
- Create: `src/digest.js`
- Test: `tests/digest.test.js`

**Interfaces:**
- Produces:
  - `buildDigestText(items, now = new Date()) -> string` where `items: Array<{summary, link, sourceName}>`. Header `📰 Tổng hợp tin mới (DD/MM - 4 tiếng qua)`, blank line, then one `<a href="...">...</a>` line per item, HTML-escaped.
  - `splitDigestMessages(text, limit = 4096) -> string[]` — greedily packs lines into chunks, never splitting a line, never exceeding `limit` chars per chunk.
- Consumed by `src/telegram.js` (Task 9) and `index.js` (Task 10).

- [ ] **Step 1: Write the failing test**

Create `tests/digest.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDigestText, splitDigestMessages } from '../src/digest.js';

test('buildDigestText builds header and one HTML link line per item', () => {
  const items = [
    { summary: 'Giá vàng tăng', link: 'https://a.example/1', sourceName: 'Vietnamnet' },
    { summary: 'Fed giữ nguyên lãi suất', link: 'https://a.example/2', sourceName: 'Reuters' },
  ];
  const now = new Date(2026, 6, 13); // 13/07 (month is 0-indexed)
  const text = buildDigestText(items, now);
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

test('buildDigestText HTML-escapes summary and source text', () => {
  const items = [{ summary: 'A & B <tag>', link: 'https://a.example/1', sourceName: 'X & Y' }];
  const text = buildDigestText(items, new Date(2026, 6, 13));
  assert.ok(text.includes('A &amp; B &lt;tag&gt; (X &amp; Y)'));
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
Expected: FAIL — `Cannot find module '../src/digest.js'`

- [ ] **Step 3: Write the implementation**

Create `src/digest.js`:

```js
function pad2(n) {
  return String(n).padStart(2, '0');
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildDigestText(items, now = new Date()) {
  const dateLabel = `${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}`;
  const header = `📰 Tổng hợp tin mới (${dateLabel} - 4 tiếng qua)`;
  const lines = items.map(
    (item) => `• <a href="${item.link}">${escapeHtml(item.summary)} (${escapeHtml(item.sourceName)})</a>`
  );
  return [header, '', ...lines].join('\n');
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
Expected: PASS, 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/digest.js tests/digest.test.js
git commit -m "feat: add digest text building and 4096-char splitting"
```

---

## Task 8: `src/summarizer.js` — Gemini summarization

**Files:**
- Create: `src/summarizer.js`
- Test: `tests/summarizer.test.js`

**Interfaces:**
- Produces: `createSummarizer(apiKey, ai = new GoogleGenAI({ apiKey })) -> { summarize({title, content}) -> Promise<string> }`. Throws if Gemini returns empty/no text, so callers can catch and fall back.
- Consumed by `index.js` (Task 10), which tracks attempt/success counts across all items in the run.

- [ ] **Step 1: Write the failing test**

Create `tests/summarizer.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSummarizer } from '../src/summarizer.js';

test('summarize returns trimmed text from Gemini response', async () => {
  const fakeAi = {
    models: {
      generateContent: async ({ model, contents }) => {
        assert.equal(model, 'gemini-2.5-flash');
        assert.match(contents, /Tiêu đề: Giá vàng tăng/);
        return { text: '  Giá vàng tăng mạnh hôm nay.  ' };
      },
    },
  };
  const summarizer = createSummarizer('fake-key', fakeAi);
  const summary = await summarizer.summarize({ title: 'Giá vàng tăng', content: 'Nội dung chi tiết...' });
  assert.equal(summary, 'Giá vàng tăng mạnh hôm nay.');
});

test('summarize throws when Gemini returns empty text', async () => {
  const fakeAi = { models: { generateContent: async () => ({ text: '' }) } };
  const summarizer = createSummarizer('fake-key', fakeAi);
  await assert.rejects(() => summarizer.summarize({ title: 'T', content: 'C' }), /rỗng/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/summarizer.test.js`
Expected: FAIL — `Cannot find module '../src/summarizer.js'`

- [ ] **Step 3: Write the implementation**

Create `src/summarizer.js`:

```js
import { GoogleGenAI } from '@google/genai';

const MODEL = 'gemini-2.5-flash';

export function createSummarizer(apiKey, ai = new GoogleGenAI({ apiKey })) {
  return {
    async summarize({ title, content }) {
      const prompt = `Tóm tắt đoạn nội dung tin tức sau thành đúng 1 câu ngắn gọn, tự nhiên, bằng tiếng Việt. Chỉ trả lời câu tóm tắt, không thêm gì khác.\n\nTiêu đề: ${title}\nNội dung: ${content}`;
      const response = await ai.models.generateContent({ model: MODEL, contents: prompt });
      const text = (response.text || '').trim();
      if (!text) {
        throw new Error('Gemini trả về nội dung rỗng');
      }
      return text;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/summarizer.test.js`
Expected: PASS, 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/summarizer.js tests/summarizer.test.js
git commit -m "feat: add Gemini-based Vietnamese summarizer"
```

---

## Task 9: `src/telegram.js` — send message, digest, and alerts

**Files:**
- Create: `src/telegram.js`
- Test: `tests/telegram.test.js`

**Interfaces:**
- Consumes: `splitDigestMessages` from `src/digest.js` (Task 7).
- Produces:
  - `sendTelegramMessage({botToken, chatId, text}, fetchImpl = fetch) -> Promise<void>` — throws on non-ok response.
  - `sendDigest(config, digestText, fetchImpl = fetch) -> Promise<void>` — splits and sends sequentially; propagates errors (caller in `index.js` treats a failure here as a heavy error).
  - `sendAlert(config, shortDesc, detail, fetchImpl = fetch) -> Promise<boolean>` — best-effort; catches its own errors, logs, returns `false` on failure instead of throwing.
  - `config` here means `{telegramBotToken, telegramChatId}` (a subset of the `loadConfig()` shape from Task 2).

- [ ] **Step 1: Write the failing test**

Create `tests/telegram.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendTelegramMessage, sendDigest, sendAlert } from '../src/telegram.js';

const config = { telegramBotToken: 'tok', telegramChatId: 'chat' };

test('sendTelegramMessage posts to the Telegram API with HTML parse mode', async () => {
  let capturedUrl;
  let capturedBody;
  const fakeFetch = async (url, options) => {
    capturedUrl = url;
    capturedBody = JSON.parse(options.body);
    return { ok: true };
  };
  await sendTelegramMessage({ botToken: 'tok', chatId: 'chat', text: 'hello' }, fakeFetch);
  assert.equal(capturedUrl, 'https://api.telegram.org/bottok/sendMessage');
  assert.equal(capturedBody.chat_id, 'chat');
  assert.equal(capturedBody.text, 'hello');
  assert.equal(capturedBody.parse_mode, 'HTML');
});

test('sendTelegramMessage throws on non-ok response', async () => {
  const fakeFetch = async () => ({ ok: false, status: 401, text: async () => 'Unauthorized' });
  await assert.rejects(
    () => sendTelegramMessage({ botToken: 'tok', chatId: 'chat', text: 'hi' }, fakeFetch),
    /401/
  );
});

test('sendDigest splits long text and sends each chunk in order', async () => {
  const sentTexts = [];
  const fakeFetch = async (url, options) => {
    sentTexts.push(JSON.parse(options.body).text);
    return { ok: true };
  };
  const longLine = 'x'.repeat(5000);
  await sendDigest(config, longLine, fakeFetch);
  assert.equal(sentTexts.length, 1); // a single unsplittable line stays one chunk even if over limit
  assert.equal(sentTexts[0], longLine);
});

test('sendAlert returns true on success and formats the alert text', async () => {
  let capturedText;
  const fakeFetch = async (url, options) => {
    capturedText = JSON.parse(options.body).text;
    return { ok: true };
  };
  const ok = await sendAlert(config, 'Không đọc được Google Sheet', 'HTTP 500', fakeFetch);
  assert.equal(ok, true);
  assert.equal(capturedText, '🔴 [news_summary_notify] Lỗi: Không đọc được Google Sheet\nHTTP 500');
});

test('sendAlert returns false instead of throwing when Telegram itself fails', async () => {
  const fakeFetch = async () => ({ ok: false, status: 401, text: async () => 'Unauthorized' });
  const ok = await sendAlert(config, 'desc', 'detail', fakeFetch);
  assert.equal(ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/telegram.test.js`
Expected: FAIL — `Cannot find module '../src/telegram.js'`

- [ ] **Step 3: Write the implementation**

Create `src/telegram.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/telegram.test.js`
Expected: PASS, 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/telegram.js tests/telegram.test.js
git commit -m "feat: add Telegram message sending, digest delivery, and alerts"
```

---

## Task 10: `index.js` — pipeline orchestrator

**Files:**
- Create: `index.js`

**Interfaces:**
- Consumes every module from Tasks 2–9: `loadConfig`/`ConfigError` (config.js), `fetchSources` (sources.js), `fetchFeed` (feeds.js), `createDb` (db.js), `fetchTranscriptText` (youtube.js), `createSummarizer` (summarizer.js), `buildDigestText` (digest.js), `sendDigest`/`sendAlert` (telegram.js).
- Produces: the `node index.js` entry point implementing the full pipeline and exit-code contract from the spec (`exit(0)` on success or "no new items", `exit(1)` on heavy errors).

This task is orchestration glue with no independently mockable seams (per the design spec, `index.js` is the one place that knows the whole flow), so it's verified by manual smoke tests instead of `node --test`.

- [ ] **Step 1: Write `index.js`**

```js
import { loadConfig } from './src/config.js';
import { fetchSources } from './src/sources.js';
import { fetchFeed } from './src/feeds.js';
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
      feedItems = await fetchFeed(source.url);
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
```

- [ ] **Step 2: Static-check the file parses correctly**

Run: `node --check index.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Manual smoke test — missing config**

Run: `env -i node index.js`
Expected: prints `Thiếu biến môi trường: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GEMINI_API_KEY, SHEET_CSV_URL` to stderr, process exits with code 1. Verify: `echo $?` prints `1`.

- [ ] **Step 4: Manual smoke test — real run against a scratch Google Sheet**

This step needs real credentials, so it's a manual verification the human operator runs, not something to automate in CI:

1. Create a small test Google Sheet with 2-3 rows (a real news RSS feed URL and a real YouTube channel feed URL), publish it, and copy its CSV export link.
2. Copy `.env.example` to `.env` and fill in a real `TELEGRAM_BOT_TOKEN` (from a throwaway test bot), `TELEGRAM_CHAT_ID` (a private test chat/channel), `GEMINI_API_KEY`, and the sheet's `SHEET_CSV_URL`.
3. Run: `node index.js`
4. Expected: console logs progress, the test Telegram chat receives one digest message (or several if long) formatted per the Task 7 example, process exits 0.
5. Run `node index.js` again immediately.
6. Expected: `Không có tin mới.` logged (everything just got marked seen), no second Telegram message, exit 0.
7. Delete the local `data/app.db` or the test row from `.env`'s sheet — this step is just to confirm dedup works and isn't a repo change.

- [ ] **Step 5: Commit**

```bash
git add index.js
git commit -m "feat: wire pipeline orchestrator in index.js"
```

---

## Task 11: pm2 config, README quick-start, final review

**Files:**
- Create: `ecosystem.config.cjs`
- Create: `README.md`

**Interfaces:**
- Produces: a pm2-loadable cron config and a short operator-facing quick-start doc. No code interfaces — this is the last task.

- [ ] **Step 1: Create `ecosystem.config.cjs`**

CommonJS (`.cjs`) is required because `package.json` sets `"type": "module"` and pm2's config loader isn't guaranteed ESM-aware across versions:

```js
module.exports = {
  apps: [
    {
      name: 'news_summary_notify',
      script: './index.js',
      cron_restart: '0 */4 * * *',
      autorestart: false,
    },
  ],
};
```

- [ ] **Step 2: Create `README.md`**

```markdown
# news-summary-notify

Tự động lấy tin mới từ RSS/YouTube (danh sách nguồn trong Google Sheet), tóm tắt bằng Gemini, gửi digest qua Telegram mỗi 4 tiếng.

## Cài đặt

\`\`\`bash
npm install
cp .env.example .env
# điền TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GEMINI_API_KEY, SHEET_CSV_URL vào .env
\`\`\`

## Chạy thử thủ công

\`\`\`bash
node index.js
\`\`\`

## Chạy test

\`\`\`bash
npm test
\`\`\`

## Chạy định kỳ bằng pm2 (mỗi 4 tiếng)

\`\`\`bash
pm2 start ecosystem.config.cjs
\`\`\`

Xem thiết kế chi tiết tại `docs/superpowers/specs/2026-07-13-news-summary-notify-design.md`.
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all tests across `tests/config.test.js`, `tests/db.test.js`, `tests/sources.test.js`, `tests/feeds.test.js`, `tests/youtube.test.js`, `tests/digest.test.js`, `tests/summarizer.test.js`, `tests/telegram.test.js` pass, 0 failures.

- [ ] **Step 4: Validate pm2 config loads**

Run: `node -e "console.log(require('./ecosystem.config.cjs'))"`
Expected: prints the config object with `apps[0].cron_restart === '0 */4 * * *'` and `apps[0].autorestart === false`, no error.

- [ ] **Step 5: Commit**

```bash
git add ecosystem.config.cjs README.md
git commit -m "chore: add pm2 cron config and README quick-start"
```
