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

## Chạy định kỳ tự động (khuyến nghị: GitHub Actions)

Workflow `.github/workflows/news-digest.yml` chạy `node index.js` mỗi 4 tiếng qua `schedule` trigger — không cần server chạy liên tục.

Thiết lập:
1. Vào repo trên GitHub → Settings → Secrets and variables → Actions → thêm 4 secret: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `GEMINI_API_KEY`, `SHEET_CSV_URL`.
2. Có thể trigger chạy thử bằng tay ở tab Actions → News digest → Run workflow.

File dedup `data/app.db` được lưu vĩnh viễn trên branch `data` (workflow tự khôi phục/lưu lại mỗi lần chạy), không dùng cache tạm nên không lo bị GitHub tự xoá.

## Chạy định kỳ bằng pm2 (tự host, cần server/máy chạy liên tục)

```bash
pm2 start ecosystem.config.cjs
```

Lưu ý: không phù hợp để chạy trên GitHub Codespaces vì Codespace tính phí theo thời gian chạy và tự tắt sau ~30 phút không hoạt động.

Xem thiết kế chi tiết tại `docs/superpowers/specs/2026-07-13-news-summary-notify-design.md`.
