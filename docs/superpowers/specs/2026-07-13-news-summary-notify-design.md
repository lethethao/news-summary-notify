# Thiết kế: News Summary Notify

**Ngày:** 2026-07-13
**Trạng thái:** Đã duyệt, chuẩn bị lên plan implementation

## 1. Mục tiêu

Xây dựng app Node.js tự động:
1. Đọc danh sách nguồn RSS (báo tin tức + kênh YouTube) từ Google Sheet
2. Lấy các item mới từ mỗi nguồn
3. Tóm tắt nội dung mỗi item (tiếng Việt) bằng Gemini API
4. Gửi 1 tin nhắn digest gộp tất cả item mới qua Telegram, mỗi 4 tiếng
5. Không gửi trùng item đã gửi trước đó

## 2. Nguồn dữ liệu (Google Sheet)

- Sheet public, đọc qua link CSV export (`.../export?format=csv`), cấu hình trong `.env` (`SHEET_CSV_URL`)
- 3 cột: `name`, `url`, `type` (`type` là `youtube` hoặc `news`)
- Đọc lại từ Sheet ở đầu mỗi lần chạy (không cache danh sách nguồn giữa các lần chạy)

## 3. Luồng xử lý (pipeline)

```
1. Đọc & validate config (.env)
2. Fetch danh sách nguồn từ Google Sheet CSV → [{name, url, type}]
3. Với mỗi nguồn:
   a. Fetch & parse RSS/Atom feed (rss-parser)
   b. Với mỗi item trong feed: so sánh guid/link với bảng seen_items trong sqlite
      → xác định item MỚI hay ĐÃ GỬI (bước này KHÔNG liên quan transcript,
        chỉ so sánh id/link)
   c. Với item mới:
      - type=news    → dùng title + description/contentSnippet có sẵn trong RSS
      - type=youtube → lấy transcript video (fallback: title+description nếu
                        không lấy được transcript)
   d. Gọi Gemini API tóm tắt nội dung thành 1 câu ngắn gọn, tiếng Việt
4. Gộp tất cả item mới (từ mọi nguồn) thành 1 digest text
5. Gửi digest qua Telegram (chia nhiều tin nhắn nếu vượt 4096 ký tự).
   Nếu không có item mới → không gửi gì.
6. Nếu gửi Telegram thành công → lưu id các item mới vào seen_items
7. Thoát process (exit 0)
```

Nếu có lỗi nặng ở bất kỳ bước nào (xem mục 6), gửi cảnh báo riêng qua Telegram (nếu credentials Telegram còn dùng được) rồi exit(1).

## 4. Kiến trúc & thư viện

Chạy bằng Node.js v24 (đã xác nhận trên host). Không dùng thư viện cần build native — host yếu, tránh rủi ro compile.

| Việc | Thư viện |
|---|---|
| Parse RSS/Atom | `rss-parser` |
| Đọc CSV từ Google Sheet | `fetch` built-in + parse CSV thủ công/`csv-parse` |
| Lấy transcript YouTube | `youtube-transcript` (pure JS, scrape caption track) |
| Gemini API | `@google/genai` SDK chính thức |
| Gửi Telegram | `fetch` tới REST API `api.telegram.org/bot<token>/sendMessage` |
| Lưu state chống trùng | `node:sqlite` (built-in Node, không cần cài package) |
| Chạy định kỳ | pm2 `cron_restart` |

## 5. Cấu trúc file

```
news_summary_notify/
├── ecosystem.config.js       # pm2 config: cron_restart '0 */4 * * *', autorestart: false
├── .env.example              # TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GEMINI_API_KEY, SHEET_CSV_URL
├── .gitignore                # .env, data/*.db, node_modules
├── index.js                  # orchestrator: gọi các module theo thứ tự pipeline, log, exit
├── src/
│   ├── config.js             # đọc & validate biến môi trường
│   ├── sources.js            # fetch CSV từ Google Sheet, parse thành [{name, url, type}]
│   ├── feeds.js              # fetch + parse từng RSS/Atom feed
│   ├── db.js                 # setup node:sqlite, isSeen(id)/markSeen(id, sourceName)
│   ├── youtube.js            # extract videoId từ link, fetch transcript, fallback description
│   ├── summarizer.js         # gọi Gemini, prompt tóm tắt tiếng Việt 1 câu, retry + fallback
│   ├── digest.js             # build text digest từ list item đã tóm tắt
│   └── telegram.js           # sendMessage + tự chia nhỏ theo giới hạn 4096 ký tự
└── data/
    └── app.db                # sqlite file, tự tạo khi chạy lần đầu
```

Mỗi module 1 trách nhiệm rõ ràng, `index.js` là nơi duy nhất biết toàn bộ luồng.

## 6. Xử lý lỗi

**Lỗi nặng (dừng cả pipeline, thông báo qua Telegram nếu credentials Telegram vẫn dùng được, rồi exit 1):**
- Không đọc được Google Sheet
- Config thiếu/sai (thiếu `GEMINI_API_KEY`...) — ngoại lệ: nếu chính `TELEGRAM_BOT_TOKEN`/`CHAT_ID` sai thì không gửi được cảnh báo, chỉ log console (pm2 logs ghi lại)
- Gemini API lỗi ở **mọi** lệnh gọi trong lần chạy → vẫn gửi digest với nội dung fallback (title + description gốc), kèm dòng cảnh báo "⚠️ Gemini API lỗi, hiển thị nội dung gốc chưa tóm tắt"

Format cảnh báo lỗi nặng: `🔴 [news_summary_notify] Lỗi: <mô tả ngắn>\n<chi tiết>`

**Lỗi nhẹ (log console, bỏ qua, không báo Telegram):**
- 1 feed RSS lỗi/timeout → skip feed đó, tiếp tục các feed khác
- 1 video YouTube không lấy được transcript → fallback title+description
- 1 item cụ thể Gemini tóm tắt lỗi (nhưng các item khác vẫn ok) → item đó dùng fallback title+description

## 7. Schema SQLite

```sql
CREATE TABLE seen_items (
  id TEXT PRIMARY KEY,        -- guid hoặc link của item
  source_name TEXT,
  seen_at INTEGER              -- unix timestamp lúc gửi thành công
);
```

## 8. Format digest Telegram

- Mỗi item = 1 dòng, toàn dòng là markdown hyperlink trỏ về link gốc
- Nội dung dòng: tóm tắt 1 câu ngắn gọn (tiếng Việt) + `(tên nguồn)` ở cuối
- Không group theo nguồn, danh sách phẳng theo thứ tự xử lý
- Nếu không có item mới trong lần chạy → không gửi gì (tránh spam)

Ví dụ:
```
📰 Tổng hợp tin mới (13/07 - 4 tiếng qua)

• [Giá vàng tăng (Vietnamnet)](link1)
• [Fed giữ nguyên lãi suất (Reuters)](link2)
• [Review iPhone mới (Tech Channel)](link3)
```

Nếu tổng độ dài vượt 4096 ký tự → tự chia thành nhiều tin nhắn gửi liên tiếp.

## 9. Lịch chạy

pm2 `ecosystem.config.js`:
- `cron_restart: '0 */4 * * *'` (mỗi 4 tiếng)
- `autorestart: false` (không tự restart khi crash ngoài lịch cron — script one-shot, chạy xong tự exit)
- Vẫn hỗ trợ chạy thủ công để test: `node index.js`

## 10. Cấu hình (.env)

```
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
GEMINI_API_KEY=
SHEET_CSV_URL=
```

## 11. Ngoài phạm vi (out of scope)

- Không có web UI/dashboard
- Không fetch toàn bộ nội dung trang báo (chỉ dùng description có sẵn trong RSS)
- Không hỗ trợ nhiều người dùng/nhiều chat Telegram khác nhau
- Không lưu lịch sử tóm tắt lâu dài ngoài mục đích chống trùng (seen_items không lưu nội dung tóm tắt)
