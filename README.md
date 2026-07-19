# news-summary-notify

Tự động lấy tin mới từ RSS/YouTube (danh sách nguồn trong Google Sheet) mỗi giờ. Gửi danh sách tin mới qua Telegram lúc 8h/16h/20h, và gửi tổng hợp đầy đủ kèm tổng quan chủ đề nổi bật trong ngày (do GitHub Models tổng hợp) lúc 12h và 0h — cộng thêm tổng quan cả tháng vào ngày 1 hàng tháng.

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

Workflow `.github/workflows/news-digest.yml` chạy `node index.js` mỗi giờ qua `schedule` trigger — không cần server chạy liên tục. Bản thân `index.js` tự quyết định mỗi lần chạy chỉ fetch tin (đa số giờ), gửi danh sách link (8h/16h/20h giờ VN), hay gửi tổng hợp AI đầy đủ (12h/0h giờ VN).

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
