import ollama from 'ollama';

const POLICY_SYSTEM_PROMPT = `Compile plain-language spending policy into structured JSON. Only output JSON.

Input: "Only electronics, under $100 each, max $200 a week, nothing after 10pm"
Output: {
  "category": "electronics",
  "maxPerItem": 100,
  "maxWeekly": 200,
  "timeWindow": { "end": "22:00" }
}

Allowed rule types (only these 4):
1. category - string (e.g., "electronics", "clothing")
2. maxPerItem - number (max dollars per single item)
3. maxWeekly - number (max dollars per week)
4. timeWindow - object { "start": "HH:MM", "end": "HH:MM" } (24-hour format)

Rules:
- Only include fields that are explicitly mentioned
- If a rule type is not mentioned, omit it entirely (null/undefined)
- Currency is always USD
- Time format: 24-hour "HH:MM"
- Output ONLY the JSON object, no explanation`;

export async function compilePolicy(plainLanguagePolicy) {
  const response = await ollama.chat({
    model: 'llama3.2:3b',
    messages: [
      { role: 'system', content: POLICY_SYSTEM_PROMPT },
      { role: 'user', content: plainLanguagePolicy }
    ],
    format: 'json'
  });
  return JSON.parse(response.message.content);
}