# Thiết kế: Đổi lịch chạy + tin tóm tắt ngày hôm qua lúc 0h

**Ngày:** 2026-07-16
**Trạng thái:** Đã duyệt, chuẩn bị lên plan implementation
**Bổ sung cho:** `docs/superpowers/specs/2026-07-16-daily-monthly-overview-design.md`, `docs/superpowers/specs/2026-07-16-daily-overview-references-design.md`

**Phạm vi:** Chỉ gồm (A) đổi lịch chạy cron và (B) thêm tin tóm tắt ngày hôm qua lúc 0h. Tầng "tổng quan tuần" + đổi nguồn tổng quan tháng sang tuần + cơ chế tự chạy bù khi thiếu dữ liệu là phạm vi lớn hơn, tách thành spec riêng sau.

## 1. Mục tiêu

- Digest tin tức chỉ chạy trong khung giờ hoạt động **6h–22h giờ VN**, mỗi 4 tiếng (6h, 10h, 14h, 18h, 22h) — bỏ lần chạy giữa đêm (hiện tại có lần chạy ~3h sáng giờ VN không cần thiết).
- Thêm 1 lần chạy riêng lúc **0h giờ VN**: không fetch tin tức, chỉ gửi 1 tin Telegram tóm tắt lại toàn bộ **ngày hôm qua** (tính lại từ đầu bằng AI, không tái sử dụng bản tổng quan đã cập nhật dần trong ngày).

## 2. Lịch chạy (GitHub Actions cron)

Giờ VN → UTC (VN = UTC+7, nên UTC = giờ VN − 7):

| Giờ VN | Giờ UTC | Loại |
|---|---|---|
| 6h | 23h (hôm trước) | digest |
| 10h | 3h | digest |
| 14h | 7h | digest |
| 18h | 11h | digest |
| 22h | 15h | digest |
| 0h | 17h (hôm trước) | daily_summary |

`.github/workflows/news-digest.yml` khai báo 2 `schedule` entries:
```yaml
on:
  schedule:
    - cron: '0 23,3,7,11,15 * * *'   # digest: 6h/10h/14h/18h/22h giờ VN
    - cron: '0 17 * * *'              # daily_summary: 0h giờ VN
  workflow_dispatch: {}
```

Job phân biệt loại lần chạy qua biến GitHub Actions có sẵn `github.event.schedule` (chứa đúng chuỗi cron nào đã trigger), set thành biến môi trường `RUN_MODE` truyền vào `node index.js`:
```yaml
env:
  RUN_MODE: ${{ github.event.schedule == '0 17 * * *' && 'daily_summary' || 'digest' }}
```
Khi trigger thủ công (`workflow_dispatch`), `github.event.schedule` rỗng → biểu thức trả `false` → `RUN_MODE=digest` (mặc định, giữ hành vi hiện tại khi test thủ công).

## 3. `index.js` — rẽ nhánh theo `RUN_MODE`

`main()` đọc `process.env.RUN_MODE`, mặc định `'digest'` nếu không set (tương thích khi chạy local không set biến này):

```
Nếu RUN_MODE === 'daily_summary':
  → chạy handleDailySummary() rồi kết thúc, KHÔNG chạy fetch sources/monthly overview/digest
Ngược lại (RUN_MODE === 'digest' hoặc không set):
  → giữ nguyên toàn bộ luồng hiện tại (handleMonthlyOverview + fetch + digest + markSeen)
```

`handleMonthlyOverview` không đổi gì — vẫn tự kiểm tra `isFirstDayOfMonthVN`, không liên quan `RUN_MODE`.

## 4. `handleDailySummary` — tóm tắt ngày hôm qua

Hàm mới trong `index.js`:

1. Tính khung "ngày hôm qua" (giờ VN): `startTs = startOfDayVN(yesterday)`, `endTs = startOfDayVN(now)` — với `yesterday = new Date(now.getTime() - 24*60*60*1000)` (VN không có DST nên trừ 24h luôn rơi đúng "hôm qua" theo lịch).
2. Lấy toàn bộ item đã `seen` trong khung `[startTs, endTs)` từ DB — cần hàm mới `db.getItemsInRange(startTs, endTs)` (khác `getTodayItems` vì có cả điểm kết thúc).
3. Nếu không có item nào → log console, không gửi gì, kết thúc.
4. Gọi `overviewSummarizer.summarizeDaily(items)` tổng hợp lại **hoàn toàn mới** (không tái sử dụng `daily_overviews` đã lưu trong ngày) — dùng lại đúng method đã có, không cần method mới.
5. Ghi đè `db.upsertDailyOverview(vnDateKey(yesterday), text, ...)` — bản tính lại lúc 0h thay thế bản cập nhật lần cuối trong ngày (22h), làm nguồn chính xác hơn cho tổng quan tháng sau này.
6. Build message: `📆 Tóm tắt ngày hôm qua (dd/mm)\n\n<nội dung đã escape + linkify>` — dùng lại `escapeHtml` (đã export) và `linkifyReferences` (**cần export thêm** từ `digest.js`, hiện đang private) để tái sử dụng đúng logic escape-rồi-linkify đã kiểm chứng, KHÔNG kèm danh sách chi tiết item.
7. Gửi qua `sendDigest(config, text)` (đã import sẵn, tự chunk nếu dài) — thành 1 tin riêng, độc lập với digest tin tức.
8. Lỗi ở bước gọi AI → log console `Tạo tóm tắt ngày hôm qua lỗi:`, không gửi gì (không có digest nào khác trong lần chạy `daily_summary` để chèn cảnh báo vào — khác với lỗi tổng quan ngày/tháng trong luồng `digest` vốn có chỗ chèn ⚠️).

## 5. Thay đổi module

- **`src/digest.js`**: export thêm `linkifyReferences` (bỏ từ khóa private, thêm `export`) — không đổi logic, không đổi test hiện có.
- **`src/db.js`**: thêm method `getItemsInRange(startTs, endTs)`:
  ```sql
  SELECT source_name AS sourceName, title, description, link
  FROM seen_items
  WHERE seen_at >= ? AND seen_at < ? AND title IS NOT NULL
  ORDER BY seen_at ASC
  ```
- **`index.js`**: thêm `handleDailySummary(config, db, overviewSummarizer, now)`, sửa `main()` để đọc `RUN_MODE` và rẽ nhánh.
- **`.github/workflows/news-digest.yml`**: đổi `schedule` thành 2 entries, thêm `RUN_MODE` vào step `env`.

## 6. Không thay đổi

- `handleMonthlyOverview`, tổng quan tháng, cơ chế `sent` tracking — không đổi.
- Digest tin tức (6h/10h/14h/18h/22h) — luồng xử lý y nguyên như hiện tại, chỉ đổi lịch chạy.
- Không thêm tầng "tuần" — nằm ngoài phạm vi spec này.

## 7. Testing

- `tests/db.test.js`: test mới cho `getItemsInRange` — item trong khung được trả về, item ngoài khung (trước `startTs` hoặc từ `endTs` trở đi) bị loại, sắp xếp theo `seen_at` tăng dần.
- `tests/digest.test.js`: test `linkifyReferences` export trực tiếp (không chỉ qua `buildDigestText` nữa).
- Không có test trực tiếp cho `handleDailySummary`/`main()` trong `index.js` — theo đúng convention hiện tại của project (không test file `index.js`), verify qua `node --check` + `npm test` (không regressions) + dry run thủ công.
