import ollama from 'ollama';

const SYSTEM_PROMPT = `Extract purchase intent as JSON. Only output JSON.
Schema: { "amount": number, "currency": "USD", "maxItems": number, "category": string, "merchantHint": string }
Rules:
- amount = max total spend
- maxItems = quantity limit
- category = product type if mentioned
- merchantHint = store name if mentioned
- If unclear, use null`;

export async function parseIntent(userPrompt) {
  const response = await ollama.chat({
    model: 'llama3.2:3b',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ],
    format: 'json'
  });
  return JSON.parse(response.message.content);
}