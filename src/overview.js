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
