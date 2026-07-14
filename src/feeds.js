import Parser from 'rss-parser';

export function normalizeFeedItem(item) {
  return {
    id: item.guid || item.link || '',
    title: item.title || '',
    link: item.link || '',
    snippet: item.contentSnippet || item.content || item.summary || '',
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchFeed(url, parser = new Parser(), retries = 3, delayMs = 2000) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const feed = await parser.parseURL(url);
      return (feed.items || []).map(normalizeFeedItem).filter((item) => item.id);
    } catch (err) {
      lastErr = err;
      if (attempt < retries - 1) {
        await sleep(delayMs * 2 ** attempt);
      }
    }
  }
  throw lastErr;
}
