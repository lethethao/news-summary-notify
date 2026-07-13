import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFeedItem, fetchFeed } from '../src/feeds.js';

test('normalizeFeedItem prefers guid over link for id', () => {
  const item = { guid: 'guid-1', link: 'https://example.com/1', title: 'Tiêu đề', contentSnippet: 'Nội dung' };
  assert.deepEqual(normalizeFeedItem(item), {
    id: 'guid-1',
    title: 'Tiêu đề',
    link: 'https://example.com/1',
    snippet: 'Nội dung',
  });
});

test('normalizeFeedItem falls back to link when guid is missing', () => {
  const item = { link: 'https://example.com/2', title: 'T', content: 'C' };
  const result = normalizeFeedItem(item);
  assert.equal(result.id, 'https://example.com/2');
  assert.equal(result.snippet, 'C');
});

test('fetchFeed normalizes items from an injected parser and drops items with no id', async () => {
  const fakeParser = {
    parseURL: async (url) => {
      assert.equal(url, 'https://example.com/rss');
      return {
        items: [
          { guid: 'a', link: 'https://example.com/a', title: 'A', contentSnippet: 'a' },
          { title: 'No id or link' },
        ],
      };
    },
  };
  const items = await fetchFeed('https://example.com/rss', fakeParser);
  assert.deepEqual(items, [{ id: 'a', title: 'A', link: 'https://example.com/a', snippet: 'a' }]);
});
