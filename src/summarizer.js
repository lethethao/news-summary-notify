import { GoogleGenAI } from '@google/genai';

const MODEL = 'gemini-flash-latest';

export function createSummarizer(apiKey, ai = new GoogleGenAI({ apiKey })) {
  return {
    async summarize({ title, content }) {
      const prompt = `Tóm tắt đoạn nội dung tin tức sau thành đúng 1 câu ngắn gọn, tự nhiên, bằng tiếng Việt. Chỉ trả lời câu tóm tắt, không thêm gì khác.\n\nTiêu đề: ${title}\nNội dung: ${content}`;
      const response = await ai.models.generateContent({ model: MODEL, contents: prompt });
      const text = (response.text || '').trim();
      if (!text) {
        throw new Error('Gemini trả về nội dung rỗng');
      }
      return text;
    },
  };
}
