import Parser from 'rss-parser';

export function normalizeFeedItem(item) {
  return {
    id: item.guid || item.link || '',
    title: item.title || '',
    link: item.link || '',
    snippet: item.contentSnippet || item.content || item.summary || '',
  };
}

export async function fetchFeed(url, parser = new Parser()) {
  const feed = await parser.parseURL(url);
  return (feed.items || []).map(normalizeFeedItem).filter((item) => item.id);
}
