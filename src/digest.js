function pad2(n) {
  return String(n).padStart(2, '0');
}

export function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function linkifyReferences(escapedText, references = []) {
  return escapedText.replace(/\[(\d+)\]/g, (match, numStr) => {
    const link = references[Number(numStr) - 1];
    return link ? `<a href="${link}">${numStr}</a>` : match;
  });
}

export function buildDigestText({ items, dailyOverview = null, monthlyOverviewError = false, now = new Date() }) {
  const dateLabel = `${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}`;
  const header = `📰 Tổng hợp tin mới (${dateLabel} - 4 tiếng qua)`;

  const sections = [header];

  if (monthlyOverviewError) {
    sections.push('⚠️ Không tạo được tổng quan tháng trước (lỗi API)');
  }

  if (dailyOverview && dailyOverview.failed) {
    sections.push('⚠️ Không tạo được tổng quan trong ngày (lỗi API)');
  } else if (dailyOverview && dailyOverview.text) {
    const escaped = escapeHtml(dailyOverview.text);
    const linked = linkifyReferences(escaped, dailyOverview.references);
    sections.push(`🔎 Tổng quan trong ngày:\n${linked}`);
  }

  const itemLines = items
    .map((item) => {
      const prefix = item.referenceNumber ? `[${item.referenceNumber}] ` : '';
      return `• ${prefix}<a href="${item.link}">${escapeHtml(item.title)} (${escapeHtml(item.sourceName)})</a>`;
    })
    .join('\n');
  sections.push(itemLines);

  return sections.join('\n\n');
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
