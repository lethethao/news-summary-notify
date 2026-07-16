const API_URL = 'https://models.github.ai/inference/chat/completions';
const MODEL = 'openai/gpt-4o-mini';

export async function chatComplete(token, prompt, fetchImpl = fetch) {
  const res = await fetchImpl(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub Models API lỗi: HTTP ${res.status} - ${body}`);
  }
  const data = await res.json();
  const text = (data.choices?.[0]?.message?.content || '').trim();
  if (!text) {
    throw new Error('GitHub Models trả về nội dung rỗng');
  }
  return text;
}
