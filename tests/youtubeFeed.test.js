import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractChannelId, fetchYoutubeChannelFeed } from '../src/youtubeFeed.js';

test('extractChannelId reads channel_id from a feed URL', () => {
  const id = extractChannelId('https://www.youtube.com/feeds/videos.xml?channel_id=UCabsTV34JwALXKGMqHpvUiA');
  assert.equal(id, 'UCabsTV34JwALXKGMqHpvUiA');
});

test('fetchYoutubeChannelFeed calls the uploads playlist and normalizes items', async () => {
  const fakeFetch = async (url) => {
    assert.match(url, /playlistItems/);
    assert.match(url, /playlistId=UUabsTV34JwALXKGMqHpvUiA/);
    assert.match(url, /key=fake-key/);
    return {
      ok: true,
      json: async () => ({
        items: [
          {
            snippet: {
              title: 'Video A',
              description: 'Mô tả A',
              resourceId: { videoId: 'vid1' },
            },
          },
          {
            snippet: {
              title: 'Video B',
              description: 'Mô tả B',
              resourceId: { videoId: 'vid2' },
            },
          },
        ],
      }),
    };
  };
  const items = await fetchYoutubeChannelFeed(
    'https://www.youtube.com/feeds/videos.xml?channel_id=UCabsTV34JwALXKGMqHpvUiA',
    'fake-key',
    fakeFetch
  );
  assert.deepEqual(items, [
    { id: 'https://www.youtube.com/watch?v=vid1', title: 'Video A', link: 'https://www.youtube.com/watch?v=vid1', snippet: 'Mô tả A' },
    { id: 'https://www.youtube.com/watch?v=vid2', title: 'Video B', link: 'https://www.youtube.com/watch?v=vid2', snippet: 'Mô tả B' },
  ]);
});

test('fetchYoutubeChannelFeed throws on non-ok response', async () => {
  const fakeFetch = async () => ({ ok: false, status: 403, text: async () => 'quota exceeded' });
  await assert.rejects(
    () => fetchYoutubeChannelFeed('https://www.youtube.com/feeds/videos.xml?channel_id=UCabsTV34JwALXKGMqHpvUiA', 'fake-key', fakeFetch),
    /YouTube API lỗi: HTTP 403/
  );
});
