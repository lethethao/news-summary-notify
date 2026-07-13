function pad2(n) {
  return String(n).padStart(2, '0');
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildDigestText(items, now = new Date()) {
  const dateLabel = `${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}`;
  const header = `📰 Tổng hợp tin mới (${dateLabel} - 4 tiếng qua)`;
  const lines = items.map(
    (item) => `• <a href="${item.link}">${escapeHtml(item.summary)} (${escapeHtml(item.sourceName)})</a>`
  );
  return [header, '', ...lines].join('\n');
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
