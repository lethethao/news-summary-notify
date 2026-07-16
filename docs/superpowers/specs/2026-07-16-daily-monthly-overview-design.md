# Thiết kế: Tổng quan ngày/tháng bằng GitHub Models (thay Gemini)

**Ngày:** 2026-07-16
**Trạng thái:** Đã duyệt, chuẩn bị lên plan implementation
**Thay thế/bổ sung:** `docs/superpowers/specs/2026-07-13-news-summary-notify-design.md`

## 1. Mục tiêu

Thay đổi lớn so với thiết kế gốc:

1. **Bỏ tóm tắt AI từng item.** Digest chỉ hiển thị tiêu đề gốc của từng tin (không qua AI nữa).
2. **Thêm tổng quan trong ngày**: mỗi digest có tin mới sẽ kèm 1 đoạn tổng hợp các chủ đề/xu hướng thời sự nổi bật trong ngày (giờ VN), tổng hợp từ tiêu đề + mô tả của tất cả tin đã thấy từ đầu ngày tới giờ — kể cả tin của các lần chạy trước trong ngày.
3. **Thêm tổng quan tháng**: vào ngày 1 hàng tháng (giờ VN), tự tổng hợp tổng quan cả tháng trước từ các tổng quan ngày đã lưu, gửi thành 1 tin Telegram riêng.
4. **Bỏ hoàn toàn Gemini** (`@google/genai`, `GEMINI_API_KEY`) và **bỏ transcript YouTube** (`youtube-transcript`, `src/youtube.js`) — không còn nơi nào dùng đến.
5. **Chuyển sang GitHub Models** (`openai/gpt-4o-mini`) làm nhà cung cấp AI duy nhất, dùng `GITHUB_TOKEN` — trong GitHub Actions dùng token tự động (thêm quyền `models: read`), không cần secret mới.

## 2. Luồng xử lý (pipeline) — `index.js`

```
1. Đọc & validate config (.env): TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
   SHEET_CSV_URL, YOUTUBE_API_KEY, GITHUB_TOKEN (đều bắt buộc)
2. Mở DB (data/app.db)
3. [Độc lập với bước 4-9] Nếu hôm nay (giờ VN) là ngày 1 hàng tháng VÀ
   chưa có tổng quan tháng trước trong DB (bảng monthly_overviews):
   a. Lấy toàn bộ daily_overviews của tháng trước
   b. Nếu có dữ liệu → gọi GitHub Models tổng hợp tổng quan tháng
      (dạng gạch đầu dòng) → lưu DB → gửi 1 tin Telegram riêng
   c. Nếu lỗi API → log console, ghi nhớ cờ lỗi để cảnh báo nếu bước 9
      có gửi digest trong cùng lần chạy này
   d. Nếu không có dữ liệu tháng trước (chưa từng chạy) → bỏ qua, không lỗi
4. Fetch danh sách nguồn từ Google Sheet CSV
5. Với mỗi nguồn: fetch feed (RSS retry 3 lần, hoặc YouTube Data API),
   lọc item chưa thấy (so với seen_items)
6. Nếu không có item mới → thoát như hiện tại (không gửi gì, kể cả không
   tính lại tổng quan ngày)
7. Với mỗi item mới: tính description đã làm sạch = cleanDescription(item.snippet)
8. Tính tổng quan trong ngày:
   a. Lấy các item đã thấy từ đầu ngày VN đến giờ từ DB (getTodayItems)
   b. Gộp với item mới của lần chạy này (title + description sạch)
   c. Gọi GitHub Models tổng hợp (dạng gạch đầu dòng, ưu tiên chủ đề
      nhiều nguồn cùng đề cập) → nếu lỗi, đánh dấu lỗi để chèn cảnh báo
   d. Upsert kết quả (nếu thành công) vào daily_overviews cho ngày hôm nay
9. Build digest text: header + [cảnh báo lỗi tổng quan tháng nếu có] +
   [đoạn tổng quan ngày hoặc cảnh báo lỗi] + danh sách tiêu đề item mới
10. Gửi digest qua Telegram (chia nhỏ nếu vượt 4096 ký tự)
11. Nếu gửi thành công → markSeen từng item mới (kèm title, description) vào DB
12. Đóng DB, exit
```

## 3. Dữ liệu đầu vào tổng quan & làm sạch description

- Cả RSS (`feeds.js`) lẫn YouTube (`youtubeFeed.js`) đã có sẵn field `snippet` (description gốc) — dùng chung cho cả 2 loại nguồn, không phân biệt.
- **`src/textClean.js`** (mới) — `cleanDescription(text)`:
  1. Xóa mọi URL trần (regex `https?:\/\/\S+`)
  2. Lọc bỏ dòng chứa từ khóa quảng cáo (không phân biệt hoa/thường): `facebook, fb.com, zalo, tiktok, instagram, fanpage, subscribe, đăng ký kênh, android, ios, app store, google play, download, tải app`
  3. Gộp khoảng trắng thừa, trim, cắt tối đa 300 ký tự
  4. Trả `''` nếu sau khi lọc không còn nội dung

## 4. Module GitHub Models

**`src/githubModels.js`** (mới) — client dùng chung:
```js
export async function chatComplete(token, prompt, fetchImpl = fetch) {
  // POST https://models.github.ai/inference/chat/completions
  // Authorization: Bearer <token>, model: "openai/gpt-4o-mini"
  // body: { model, messages: [{ role: 'user', content: prompt }] }
  // trả về response.choices[0].message.content.trim()
  // throw Error nếu HTTP không ok, hoặc content rỗng
}
```

**`src/overview.js`** (mới) — dùng `githubModels.js`:
```js
export function createOverviewSummarizer(token, chatFn = chatComplete) {
  return {
    // items: [{ sourceName, title, description }]
    async summarizeDaily(items) { ... },
    // dailyOverviews: [{ date, text }] (đã sắp theo ngày)
    async summarizeMonthly(dailyOverviews, monthLabel) { ... },
  };
}
```
- Prompt `summarizeDaily`: liệt kê từng dòng `- [Nguồn] Tiêu đề: Description` (bỏ `: Description` nếu rỗng), yêu cầu trả về **danh sách gạch đầu dòng** (3-7 dòng) nêu chủ đề/xu hướng nổi bật nhất, ưu tiên chủ đề được nhiều nguồn khác nhau cùng đề cập lên đầu.
- Prompt `summarizeMonthly`: liệt kê `<ngày>: <tổng quan ngày>` cho từng ngày trong tháng, yêu cầu trả về danh sách gạch đầu dòng tổng hợp các chủ đề/sự kiện lớn nổi bật nhất trong cả tháng, ưu tiên chủ đề lặp lại nhiều ngày.
- `summarizer.js` (Gemini per-item) bị **xóa hoàn toàn**, không thay thế bằng gì (item hiển thị tiêu đề gốc trực tiếp).

## 5. Schema SQLite (`src/db.js`)

```sql
CREATE TABLE IF NOT EXISTS seen_items (
  id TEXT PRIMARY KEY,
  source_name TEXT,
  seen_at INTEGER,
  title TEXT,
  description TEXT
);

CREATE TABLE IF NOT EXISTS daily_overviews (
  date TEXT PRIMARY KEY,        -- 'YYYY-MM-DD' theo giờ VN
  overview_text TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS monthly_overviews (
  month TEXT PRIMARY KEY,       -- 'YYYY-MM' (tháng được tổng hợp)
  overview_text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

- `title`/`description` trên `seen_items` là cột mới trên bảng đã tồn tại → migration idempotent: kiểm tra qua `PRAGMA table_info(seen_items)` trước khi `ALTER TABLE ... ADD COLUMN`.
- API `db.js` cập nhật:
  - `markSeen(id, sourceName, title, description, seenAt)`
  - `getTodayItems(sinceTs)` → `[{ sourceName, title, description }]`, `WHERE seen_at >= sinceTs AND title IS NOT NULL`
  - `upsertDailyOverview(date, text, updatedAt)` (INSERT OR REPLACE)
  - `getDailyOverviewsForMonth(monthKey)` → `[{ date, text }]` sắp theo `date`
  - `getMonthlyOverview(monthKey)` → text hoặc `undefined`
  - `saveMonthlyOverview(monthKey, text, createdAt)`

## 6. Thời gian — `src/time.js` (mới)

Mọi mốc ngày/tháng tính theo giờ Việt Nam (UTC+7), không phải giờ server (UTC trên GitHub Actions):

- `startOfDayVN(now = new Date())` → unix seconds, mốc 00:00 giờ VN của ngày chứa `now`
- `vnDateKey(now)` → chuỗi `'YYYY-MM-DD'` theo giờ VN
- `isFirstDayOfMonthVN(now)` → boolean
- `previousMonthKey(now)` → chuỗi `'YYYY-MM'` của tháng liền trước tháng chứa `now` (giờ VN)
- `monthKeyRangePrefix` dùng để lọc `daily_overviews` theo tháng (so khớp `date` bắt đầu bằng `'YYYY-MM-'`)

## 7. Định dạng digest Telegram (`src/digest.js`)

```
📰 Tổng hợp tin mới (16/07 - 4 tiếng qua)

🔎 Tổng quan trong ngày:
• Chủ đề A ...
• Chủ đề B ...

• <a href="link1">Tiêu đề 1 (Nguồn 1)</a>
• <a href="link2">Tiêu đề 2 (Nguồn 2)</a>
```

- `buildDigestText({ items, dailyOverview, monthlyOverviewError, now })`:
  - `items`: `[{ title, link, sourceName }]` (không còn `summary`)
  - `dailyOverview`: `{ text: string }` khi thành công, `{ failed: true }` khi lỗi API
  - Nếu `dailyOverview.failed` → chèn dòng `⚠️ Không tạo được tổng quan trong ngày (lỗi API)` thay cho khối tổng quan
  - Nếu `monthlyOverviewError` = true (lỗi tổng quan tháng xảy ra cùng lần chạy có digest này) → chèn thêm dòng `⚠️ Không tạo được tổng quan tháng trước (lỗi API)` ở đầu digest
- Tổng quan tháng gửi **thành 1 tin Telegram riêng** khi thành công (không chèn vào digest tin tức): `📅 Tổng quan tháng {MM/YYYY}\n\n<nội dung gạch đầu dòng>`
- `escapeHtml` dùng chung cho cả tiêu đề item lẫn nội dung tổng quan (đều do nguồn ngoài/AI sinh ra, cần escape trước khi chèn HTML gửi Telegram)

## 8. Xử lý lỗi

| Tình huống | Xử lý |
|---|---|
| Thiếu `GITHUB_TOKEN`/env bắt buộc khác | ConfigError như hiện tại — báo Telegram (nếu còn dùng được), `exit 1` |
| 1 nguồn RSS/YouTube lỗi fetch | Log console, bỏ qua nguồn đó, tiếp tục |
| Gọi GitHub Models lỗi khi tạo tổng quan **ngày** | Không throw pipeline — đánh dấu `dailyOverview.failed = true`, digest vẫn gửi kèm dòng cảnh báo, không lưu `daily_overviews` cho ngày đó (giữ bản cũ nếu có) |
| Gọi GitHub Models lỗi khi tạo tổng quan **tháng** | Log console; nếu lần chạy đó có digest tin tức → chèn cảnh báo vào digest; nếu không có digest (không có tin mới) → chỉ log, không gửi gì thêm (chấp nhận, hiếm gặp) |
| Gửi Telegram thất bại (digest chính) | Giữ nguyên hành vi hiện tại: log lỗi, `exit 1`, không `markSeen` |

## 9. Config & GitHub Actions

- **`src/config.js`**: `REQUIRED_KEYS` = `TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, SHEET_CSV_URL, YOUTUBE_API_KEY, GITHUB_TOKEN` (bỏ `GEMINI_API_KEY`). `loadConfig()` trả `githubToken` thay `geminiApiKey`.
- **`package.json`**: gỡ `@google/genai`, gỡ `youtube-transcript`.
- **`.env.example`**: thay `GEMINI_API_KEY=` bằng `GITHUB_TOKEN=`.
- **`.github/workflows/news-digest.yml`**:
  - `permissions` thêm `models: read`
  - Step `run: node index.js`: env thay `GEMINI_API_KEY` bằng `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` (token tự động của Actions, không cần tạo secret mới)
- **README.md**: cập nhật hướng dẫn setup (bỏ nhắc Gemini/transcript, thêm ghi chú `GITHUB_TOKEN` cần PAT quyền "Models: read" khi chạy local ngoài Actions).

## 10. Cấu trúc file (thay đổi)

```
src/
├── config.js          # sửa: GITHUB_TOKEN thay GEMINI_API_KEY
├── sources.js          # không đổi
├── feeds.js             # không đổi
├── youtubeFeed.js        # không đổi
├── youtube.js            # XÓA (transcript không còn dùng)
├── summarizer.js          # XÓA (tóm tắt từng item bị bỏ)
├── db.js                   # sửa: thêm cột + bảng + hàm mới (mục 5)
├── textClean.js             # MỚI: cleanDescription()
├── githubModels.js           # MỚI: client chat completion dùng chung
├── overview.js                # MỚI: summarizeDaily() + summarizeMonthly()
├── time.js                     # MỚI: mốc thời gian theo giờ VN
├── digest.js                    # sửa: buildDigestText nhận items title-only + overview
└── telegram.js                   # không đổi (dùng lại sendTelegramMessage cho tin tổng quan tháng)
```

## 11. Testing plan

- `tests/textClean.test.js` (mới): xóa URL, lọc từ khóa quảng cáo, cắt độ dài, chuỗi rỗng sau lọc
- `tests/githubModels.test.js` (mới): happy path parse response, HTTP lỗi throw, content rỗng throw
- `tests/overview.test.js` (mới): build prompt đúng định dạng cho `summarizeDaily`/`summarizeMonthly`, xử lý lỗi API
- `tests/time.test.js` (mới): `startOfDayVN`/`vnDateKey`/`isFirstDayOfMonthVN`/`previousMonthKey` quanh biên nửa đêm VN vs UTC, biên đầu tháng
- `tests/db.test.js` (sửa): `markSeen` chữ ký mới, `getTodayItems`, `upsertDailyOverview`/`getDailyOverviewsForMonth`, `getMonthlyOverview`/`saveMonthlyOverview`, migration cột mới trên DB cũ
- `tests/digest.test.js` (sửa): item title-only (không `summary`), chèn khối tổng quan thành công/lỗi, chèn cảnh báo tổng quan tháng
- `tests/config.test.js` (sửa): `GITHUB_TOKEN` bắt buộc, `GEMINI_API_KEY` không còn liên quan
- `tests/youtube.test.js`, `tests/summarizer.test.js`: **xóa** (module tương ứng không còn tồn tại)
- `tests/feeds.test.js`, `tests/sources.test.js`, `tests/youtubeFeed.test.js`, `tests/telegram.test.js`: không đổi
