// gemini.js
// Thin wrapper around the Google Gen AI SDK (Gemini) so the rest of the
// backend doesn't need to know API details. Uses the free tier by default.

import { GoogleGenAI } from '@google/genai';

let client = null;

function getClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      'GEMINI_API_KEY is not set. Copy .env.example to .env and add your key from https://aistudio.google.com/apikey'
    );
  }
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

// Free-tier friendly model. Swap to 'gemini-2.5-flash-lite' for a higher
// daily request cap with slightly lower quality, or 'gemini-2.5-pro' for
// better quality with a much lower free daily cap.
const MODEL = 'gemini-2.5-flash';

// messages: [{ role: 'user' | 'assistant', content: string }]
// Gemini calls the assistant role 'model', so we translate here.
export async function chatComplete({ system, messages, maxTokens = 1000 }) {
  const ai = getClient();

  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  const response = await ai.models.generateContent({
    model: MODEL,
    contents,
    config: {
      systemInstruction: system,
      maxOutputTokens: maxTokens
    }
  });

  return (response.text || '').trim();
}
