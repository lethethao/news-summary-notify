import { parse } from 'csv-parse/sync';

const VALID_TYPES = new Set(['youtube', 'news']);

export function parseSourcesCsv(csvText) {
  const records = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });
  return records
    .filter((row) => VALID_TYPES.has(row.type))
    .map((row) => ({ name: row.name, url: row.url, type: row.type }));
}

export async function fetchSources(csvUrl, fetchImpl = fetch) {
  const res = await fetchImpl(csvUrl);
  if (!res.ok) {
    throw new Error(`Không tải được Google Sheet CSV: HTTP ${res.status}`);
  }
  const csvText = await res.text();
  return parseSourcesCsv(csvText);
}
