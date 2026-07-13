import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSourcesCsv, fetchSources } from '../src/sources.js';

test('parseSourcesCsv parses valid rows', () => {
  const csv = 'name,url,type\nVietnamnet,https://vietnamnet.vn/rss,news\nTech Channel,https://youtube.com/feeds/x,youtube\n';
  const sources = parseSourcesCsv(csv);
  assert.deepEqual(sources, [
    { name: 'Vietnamnet', url: 'https://vietnamnet.vn/rss', type: 'news' },
    { name: 'Tech Channel', url: 'https://youtube.com/feeds/x', type: 'youtube' },
  ]);
});

test('parseSourcesCsv filters out rows with an invalid type', () => {
  const csv = 'name,url,type\nBad Row,https://example.com,podcast\nGood Row,https://example.com/2,news\n';
  const sources = parseSourcesCsv(csv);
  assert.deepEqual(sources, [{ name: 'Good Row', url: 'https://example.com/2', type: 'news' }]);
});

test('fetchSources fetches CSV text then parses it', async () => {
  const fakeFetch = async (url) => {
    assert.equal(url, 'https://sheet.example/export?format=csv');
    return {
      ok: true,
      text: async () => 'name,url,type\nA,https://a.example/rss,news\n',
    };
  };
  const sources = await fetchSources('https://sheet.example/export?format=csv', fakeFetch);
  assert.deepEqual(sources, [{ name: 'A', url: 'https://a.example/rss', type: 'news' }]);
});

test('fetchSources throws on non-ok response', async () => {
  const fakeFetch = async () => ({ ok: false, status: 404 });
  await assert.rejects(() => fetchSources('https://sheet.example/bad', fakeFetch), /404/);
});
