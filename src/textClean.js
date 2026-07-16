const URL_PATTERN = /https?:\/\/\S+/gi;
const SEGMENT_DELIMITER = /(?<=[.!?])\s+|\n+/;
const MAX_LENGTH = 300;

const WORD_BOUNDARY_KEYWORDS = [
  'facebook', 'fb.com', 'zalo', 'tiktok', 'instagram', 'fanpage',
  'subscribe', 'android', 'ios', 'app store', 'google play', 'download',
];
const SUBSTRING_KEYWORDS = ['đăng ký kênh', 'tải app'];

const WORD_BOUNDARY_PATTERNS = WORD_BOUNDARY_KEYWORDS.map(
  (keyword) => new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'i')
);

function containsAdKeyword(segment) {
  const lower = segment.toLowerCase();
  if (WORD_BOUNDARY_PATTERNS.some((pattern) => pattern.test(segment))) return true;
  return SUBSTRING_KEYWORDS.some((keyword) => lower.includes(keyword));
}

export function cleanDescription(text) {
  if (!text) return '';
  const withoutUrls = text.replace(URL_PATTERN, ' ');
  const segments = withoutUrls.split(SEGMENT_DELIMITER);
  const cleaned = segments
    .filter((segment) => segment.trim() && !containsAdKeyword(segment))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, MAX_LENGTH);
}
