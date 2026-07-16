const AD_KEYWORDS = [
  'facebook', 'fb.com', 'zalo', 'tiktok', 'instagram', 'fanpage',
  'subscribe', 'đăng ký kênh', 'android', 'ios', 'app store',
  'google play', 'download', 'tải app',
];

const URL_PATTERN = /https?:\/\/\S+/gi;
const MAX_LENGTH = 300;

export function cleanDescription(text) {
  if (!text) return '';
  const withoutUrls = text.replace(URL_PATTERN, ' ');
  const lines = withoutUrls.split('\n').filter((line) => {
    const lower = line.toLowerCase();
    return !AD_KEYWORDS.some((keyword) => lower.includes(keyword));
  });
  const cleaned = lines.join(' ').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, MAX_LENGTH);
}
