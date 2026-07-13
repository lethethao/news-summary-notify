import { YoutubeTranscript } from 'youtube-transcript';

const ID_PATTERNS = [
  /youtube\.com\/watch\?v=([\w-]{11})/,
  /youtu\.be\/([\w-]{11})/,
  /youtube\.com\/shorts\/([\w-]{11})/,
  /youtube\.com\/embed\/([\w-]{11})/,
];

export function extractVideoId(url) {
  for (const pattern of ID_PATTERNS) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export async function fetchTranscriptText(url, transcriptFetcher = YoutubeTranscript.fetchTranscript) {
  const videoId = extractVideoId(url);
  if (!videoId) return null;
  try {
    const segments = await transcriptFetcher(videoId);
    const text = segments.map((segment) => segment.text).join(' ').trim();
    return text || null;
  } catch {
    return null;
  }
}
