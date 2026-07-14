export function extractChannelId(feedUrl) {
  return new URL(feedUrl).searchParams.get('channel_id');
}

export async function fetchYoutubeChannelFeed(feedUrl, apiKey, fetchImpl = fetch) {
  const channelId = extractChannelId(feedUrl);
  if (!channelId) {
    throw new Error(`Không tìm thấy channel_id trong URL: ${feedUrl}`);
  }
  const uploadsPlaylistId = `UU${channelId.slice(2)}`;
  const apiUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=15&playlistId=${uploadsPlaylistId}&key=${apiKey}`;

  const response = await fetchImpl(apiUrl);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`YouTube API lỗi: HTTP ${response.status} - ${body}`);
  }

  const data = await response.json();
  return (data.items || [])
    .filter((item) => item.snippet?.resourceId?.videoId)
    .map((item) => {
      const videoId = item.snippet.resourceId.videoId;
      const link = `https://www.youtube.com/watch?v=${videoId}`;
      return {
        id: link,
        title: item.snippet.title || '',
        link,
        snippet: item.snippet.description || '',
      };
    });
}
