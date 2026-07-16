# Thiết kế: Reference link cho tổng quan trong ngày

**Ngày:** 2026-07-16
**Trạng thái:** Đã duyệt, chuẩn bị lên plan implementation
**Bổ sung cho:** `docs/superpowers/specs/2026-07-16-daily-monthly-overview-design.md`

## 1. Mục tiêu

Mỗi gạch đầu dòng trong "🔎 Tổng quan trong ngày" của digest hiện chỉ là văn bản thuần, không có cách nào bấm vào để xem tin gốc. Thêm reference số thứ tự bấm được (`[1]`, `[2]`...) vào cuối mỗi gạch đầu dòng, trỏ tới đúng bài viết/video gốc liên quan.

**Phạm vi:** Chỉ áp dụng cho tổng quan **trong ngày**. Tổng quan **tháng** giữ nguyên không có reference (vì nó tổng hợp từ các đoạn tổng quan ngày đã lưu, không phải từ item gốc có link trực tiếp).

**Cách đánh số:** Đánh số toàn cục (global) theo thứ tự thời gian xuất hiện trong ngày — không đánh số riêng theo từng nguồn.

## 2. Schema & luồng dữ liệu

- `seen_items` (SQLite) thêm cột `link TEXT`, thêm qua `ensureColumn(db, 'seen_items', 'link', 'TEXT')` — theo đúng pattern idempotent đã dùng cho `title`/`description`.
- `db.js` cập nhật:
  - `markSeen(id, sourceName, title, description, link, seenAt = now)` — thêm tham số `link` (chèn trước `seenAt`, giữ `seenAt` ở cuối cùng theo convention hiện tại)
  - `getTodayItems(sinceTs)` → `[{sourceName, title, description, link}]` — SELECT thêm cột `link`
- `index.js`:
  - `overviewInput = [...todayItems, ...newItems.map(item => ({sourceName: item.sourceName, title: item.title, description: item.description, link: item.link}))]` — giữ nguyên thứ tự cũ→mới, thứ tự này chính là số thứ tự trích dẫn `[1][2][3]...`
  - Sau khi gọi `summarizeDaily(overviewInput)` thành công, tính `references = overviewInput.map(item => item.link)` (mảng, index 0 = tin `[1]`, index 1 = tin `[2]`, v.v.)
  - `dailyOverview = { text, references }` khi thành công (thay vì chỉ `{ text }` như trước)
  - `db.markSeen(item.id, item.sourceName, item.title, item.description, item.link, seenAt)` — thêm `item.link`

## 3. Prompt (`src/overview.js`)

`buildDailyPrompt(items)` sửa `formatItemLine` để thêm số thứ tự (1-based, theo vị trí trong mảng `items`):
```
[1] [Vietnamnet] Giá vàng tăng: Vàng SJC lên 90 triệu
[2] [YouTube Kinh tế] Bản tin chiều
...
```

Prompt yêu cầu thêm: cuối mỗi gạch đầu dòng, thêm số tham chiếu của các tin liên quan trong ngoặc vuông (ví dụ `[1][3][5]`), **dùng đúng số đã cho ở trên, không tự đặt số mới**. AI vẫn chỉ trả lời danh sách gạch đầu dòng, không thêm ghi chú khác — hành vi ưu tiên chủ đề nhiều nguồn cùng đề cập giữ nguyên như thiết kế cũ.

## 4. Render (`src/digest.js`)

`buildDigestText` xử lý khối tổng quan ngày theo đúng thứ tự bắt buộc để tránh XSS/hỏng HTML:

1. `escapeHtml(dailyOverview.text)` trước — an toàn nếu AI lỡ sinh `&`, `<`, `>` trong câu
2. Sau đó chạy hàm mới `linkifyReferences(escapedText, references)` — thay mỗi `[n]` bằng `<a href="link">n</a>`, dùng regex `/\[(\d+)\]/g` trên text **đã escape** (không escape lại sau bước này, vì sẽ làm hỏng thẻ `<a>` vừa chèn)

`linkifyReferences`:
```js
function linkifyReferences(escapedText, references = []) {
  return escapedText.replace(/\[(\d+)\]/g, (match, numStr) => {
    const link = references[Number(numStr) - 1];
    return link ? `<a href="${link}">${numStr}</a>` : match;
  });
}
```

- Nếu AI trích dẫn số ngoài phạm vi (vượt quá số item, hoặc item đó thiếu `link` — trường hợp dữ liệu cũ từ trước khi có cột `link`, giá trị `NULL`) → giữ nguyên `[n]` dạng chữ, không lỗi, không crash.
- `buildDigestText`'s `dailyOverview` param: `{ text, references }` khi thành công, `{ failed: true }` khi lỗi (không đổi), `references` là optional — nếu thiếu thì bỏ qua bước linkify (giữ nguyên `[n]` dạng chữ).

## 5. Không thay đổi

- `daily_overviews` table (lưu text đã tổng hợp) giữ nguyên — không lưu `references`, vì references chỉ có ý nghĩa trong phạm vi 1 lần chạy cụ thể (tính lại mỗi lần từ `overviewInput` hiện tại, không tái sử dụng qua các lần chạy khác).
- Tổng quan tháng (`buildMonthlyPrompt`, `handleMonthlyOverview`) không đổi — text tổng quan ngày đã lưu (có thể chứa các `[n]` cũ, không còn ý nghĩa) được đưa thẳng vào prompt tháng như hiện tại, không cần làm sạch thêm (LLM đủ khả năng bỏ qua các số ngoặc vuông rời rạc khi tổng hợp).

## 6. Testing

- `tests/db.test.js`: cập nhật `markSeen`/`getTodayItems` test cho tham số/field `link` mới
- `tests/overview.test.js`: cập nhật `buildDailyPrompt` test để xác nhận có số thứ tự `[n]` và hướng dẫn trích dẫn trong prompt
- `tests/digest.test.js`: test mới cho `linkifyReferences` (qua `buildDigestText`) — trích dẫn hợp lệ thành link, trích dẫn ngoài phạm vi giữ nguyên dạng chữ, thứ tự escape-rồi-linkify không bị phá vỡ khi AI text chứa `&`/`<`/`>`
