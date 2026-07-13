import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractVideoId, fetchTranscriptText } from '../src/youtube.js';

test('extractVideoId handles watch, youtu.be, shorts, embed forms', () => {
  assert.equal(extractVideoId('https://www.youtube.com/watch?v=abc123DEF45'), 'abc123DEF45');
  assert.equal(extractVideoId('https://youtu.be/abc123DEF45'), 'abc123DEF45');
  assert.equal(extractVideoId('https://www.youtube.com/shorts/abc123DEF45'), 'abc123DEF45');
  assert.equal(extractVideoId('https://www.youtube.com/embed/abc123DEF45'), 'abc123DEF45');
  assert.equal(extractVideoId('https://www.youtube.com/watch?v=abc123DEF45&t=30s'), 'abc123DEF45');
});

test('extractVideoId returns null for a non-video URL', () => {
  assert.equal(extractVideoId('https://example.com/not-youtube'), null);
});

test('fetchTranscriptText joins transcript segments into one string', async () => {
  const fakeFetcher = async (videoId) => {
    assert.equal(videoId, 'abc123DEF45');
    return [{ text: 'Xin chào' }, { text: 'thế giới' }];
  };
  const text = await fetchTranscriptText('https://youtu.be/abc123DEF45', fakeFetcher);
  assert.equal(text, 'Xin chào thế giới');
});

test('fetchTranscriptText returns null when the URL has no video id', async () => {
  const text = await fetchTranscriptText('https://example.com/not-youtube', async () => {
    throw new Error('should not be called');
  });
  assert.equal(text, null);
});

test('fetchTranscriptText returns null when the fetcher throws', async () => {
  const text = await fetchTranscriptText('https://youtu.be/abc123DEF45', async () => {
    throw new Error('transcripts disabled');
  });
  assert.equal(text, null);
});
