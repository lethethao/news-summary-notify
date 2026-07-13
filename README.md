# news-summary-notify

Tự động lấy tin mới từ RSS/YouTube (danh sách nguồn trong Google Sheet), tóm tắt bằng Gemini, gửi digest qua Telegram mỗi 4 tiếng.

## Cài đặt

```bash
npm install
cp .env.example .env
# điền TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GEMINI_API_KEY, SHEET_CSV_URL vào .env
```

## Chạy thử thủ công

```bash
node index.js
```

## Chạy test

```bash
npm test
```

## Chạy định kỳ bằng pm2 (mỗi 4 tiếng)

```bash
pm2 start ecosystem.config.cjs
```

Xem thiết kế chi tiết tại `docs/superpowers/specs/2026-07-13-news-summary-notify-design.md`.
