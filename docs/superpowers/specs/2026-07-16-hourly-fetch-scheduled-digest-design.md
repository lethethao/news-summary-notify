# Thiết kế: Fetch mỗi giờ, gửi theo 3 chế độ trong ngày

**Ngày:** 2026-07-16
**Trạng thái:** Đã duyệt, chuẩn bị lên plan implementation
**THAY THẾ HOÀN TOÀN:** `docs/superpowers/specs/2026-07-16-schedule-and-daily-summary-design.md` và `docs/superpowers/plans/2026-07-16-schedule-and-daily-summary.md` (spec/plan đó không còn được implement — giữ lại chỉ để tham khảo lịch sử thiết kế).

## 1. Mục tiêu

Tách rời việc **fetch tin** (chạy thường xuyên, mỗi giờ) khỏi việc **gửi Telegram** (chỉ ở các mốc giờ cố định trong ngày), thay vì mỗi lần chạy đều vừa fetch vừa gửi như hiện tại.

## 2. Lịch chạy

Workflow chạy **mỗi giờ, cả ngày** — cron `0 * * * *` (UTC), 24 lần/ngày. Không cần nhiều `schedule` entries hay biến `RUN_MODE` từ workflow YAML — `index.js` tự tính giờ hiện tại theo giờ VN và quyết định chế độ.

| Giờ VN | Chế độ | Số lần/ngày |
|---|---|---|
| 8h, 16h, 20h | `link_digest` | 3 |
| 12h, 0h | `ai_digest` | 2 |
| 19 giờ còn lại | `fetch_only` | 19 |

## 3. Luồng chung — mọi lần chạy (bất kể chế độ)

1. Load config, mở DB, tạo `overviewSummarizer`.
2. `handleMonthlyOverview` — **không đổi**, vẫn chạy độc lập mỗi lần, tự kiểm tra `isFirstDayOfMonthVN`.
3. Đọc nguồn từ Google Sheet, fetch feed từng nguồn, lọc tin mới qua `isSeen`.
4. **Thay đổi hành vi quan trọng:** `markSeen` (lưu `id, sourceName, title, description, link`) chạy **ngay sau khi fetch xong**, không đợi gửi Telegram thành công như hiện tại — vì phần lớn lần chạy (`fetch_only`) không gửi gì cả. Dữ liệu không bao giờ mất: mọi tin đã fetch đều nằm trong DB, `ai_digest` luôn tổng hợp lại từ DB (không phụ thuộc biến tạm trong bộ nhớ) nên tự nhiên có khả năng "bắt lại" tin nếu một lần gửi trước đó thất bại.
5. Từ bước này, rẽ nhánh theo chế độ (xem §4-§6).

## 4. Chế độ `fetch_only` (19 lần/ngày)

Chỉ làm đúng bước 1-4 ở trên rồi kết thúc — không gọi AI, không gửi Telegram, dù có tin mới hay không.

## 5. Chế độ `link_digest` (8h, 16h, 20h)

- Nếu không có tin mới trong lần chạy này → không gửi gì (giữ nguyên tinh thần "không spam khi không có gì mới").
- Nếu có tin mới → build digest **chỉ gồm header + danh sách title/link** (tái sử dụng `buildDigestText({ items, dailyOverview: null, now })` — khi `dailyOverview` là `null`, hàm này đã tự động bỏ qua khối tổng quan, không cần code render mới) → gửi qua `sendDigest`.
- **Không gọi AI** — không có đoạn tổng quan, không có số tham chiếu `[n]`.

## 6. Chế độ `ai_digest` (12h và 0h)

- **12h**: khung tổng hợp = `[startOfDayVN(now), now)` — toàn bộ tin từ 0h hôm nay đến 12h.
- **0h**: khung tổng hợp = `[startOfDayVN(yesterday), startOfDayVN(now))` — toàn bộ tin của **cả ngày hôm qua** vừa kết thúc (giống cách tính "ngày hôm qua" trong thiết kế trước, `yesterday = now - 24h`).
- Query `db.getItemsInRange(startTs, endTs)` lấy **toàn bộ** tin trong khung — **bao gồm cả tin đã gửi ở `link_digest` trước đó trong cùng khung** (không loại trừ, vì mục đích là "bức tranh đầy đủ tính đến giờ đó", chấp nhận trùng lặp tiêu đề giữa các lần gửi trong ngày).
- Nếu khung không có tin nào → không gửi gì.
- Nếu có tin: đánh số `[1]..[N]` theo thứ tự, gọi `overviewSummarizer.summarizeDaily(...)` tổng hợp chủ đề nổi bật (ưu tiên chủ đề nhiều nguồn cùng đề cập — prompt không đổi).
- Ghi đè `daily_overviews` cho đúng ngày đó (12h → hôm nay; 0h → hôm qua) — dùng làm nguồn cho tổng quan tháng như thiết kế hiện có, không đổi gì ở tầng đó.
- Build digest **đầy đủ**: tổng quan (linkify `[n]` thành link thật) + **toàn bộ danh sách tin trong khung** (không chỉ tin mới), mỗi dòng có `[n]` khớp với trích dẫn — tái sử dụng `buildDigestText` với `items` là toàn bộ item trong khung (không phải `newItems`).
- Gửi qua `sendDigest`. Lỗi gọi AI hoặc gửi Telegram → log console (`console.error`), không `sendAlert`, không crash tiến trình — nhất quán với cách xử lý lỗi digest hiện tại.

## 7. Module thay đổi

- **`src/time.js`**: thêm `hourVN(now = new Date())` → trả về giờ (0-23) theo giờ VN, dùng `toVnDate` nội bộ đã có.
- **`src/db.js`**: không đổi — `getItemsInRange`, `markSeen`, `getTodayItems` đã có sẵn từ thiết kế trước, dùng lại nguyên trạng.
- **`src/digest.js`**: không đổi — `buildDigestText` đã hỗ trợ `dailyOverview: null` (bỏ qua khối tổng quan) từ trước.
- **`index.js`**: viết lại toàn bộ orchestration theo §3-§6. Hàm mới: `determineRunMode(now)` trả về `'fetch_only' | 'link_digest' | 'ai_digest'`.
- **`.github/workflows/news-digest.yml`**: đổi `schedule` thành 1 entry duy nhất `cron: '0 * * * *'`. Bỏ biến `RUN_MODE` (không còn cần thiết vì logic nằm trong `index.js`).
- **`README.md`**: cập nhật mô tả lịch chạy cho khớp thiết kế mới.

## 8. Không thay đổi

- `handleMonthlyOverview`, tổng quan tháng, cơ chế `sent` tracking.
- `escapeHtml`, `linkifyReferences`, `getItemsInRange` — dùng lại nguyên trạng từ các thiết kế trước.
- Không có tầng "tuần" — vẫn ngoài phạm vi (tách spec riêng như đã thống nhất).

## 9. Testing

- `tests/time.test.js`: test mới cho `hourVN` — vài mốc giờ VN cụ thể quanh biên UTC/VN (đặc biệt giờ 0 và giờ 23, nơi UTC và VN lệch ngày).
- Không test trực tiếp `index.js` (theo convention hiện tại của project) — verify qua `node --check`, `npm test` (không regressions), và dry run thủ công.
