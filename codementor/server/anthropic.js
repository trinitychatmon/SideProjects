// anthropic.js
// Thin wrapper around the Anthropic SDK so the rest of the backend
// doesn't need to know API details.

import Anthropic from '@anthropic-ai/sdk';

let client = null;

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.'
    );
  }
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

const MODEL = 'claude-sonnet-4-6';

// messages: [{ role: 'user' | 'assistant', content: string }]
export async function chatComplete({ system, messages, maxTokens = 1000 }) {
  const anthropic = getClient();
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages
  });
  return response.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n')
    .trim();
}
