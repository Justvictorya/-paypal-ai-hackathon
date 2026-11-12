import ollama from 'ollama';

const POLICY_SYSTEM_PROMPT = `Compile plain-language spending policy into structured JSON. Only output JSON.

Input: "Only electronics, under $100 each, max $200 a week, nothing after 10pm"
Output: {
  "category": "electronics",
  "maxPerItem": 100,
  "maxTotal": 200,
  "maxItems": 3,
  "maxWeekly": 200,
  "timeWindow": { "end": "22:00" }
}

Allowed rule types (only these 6):
1. category - string (e.g., "electronics", "clothing")
2. maxPerItem - number (max dollars per single item)
3. maxTotal - number (max dollars per order)
4. maxItems - number (max quantity per order)
5. maxWeekly - number (max dollars per week)
6. timeWindow - object { "start": "HH:MM", "end": "HH:MM" } (24-hour format)

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
  let policy = JSON.parse(response.message.content);
  
  // Normalize field names from common LLM variations
  if (policy.maxPerOrder !== undefined) {
    policy.maxTotal = policy.maxPerOrder;
    delete policy.maxPerOrder;
  }
  if (policy.maxQuantity !== undefined) {
    policy.maxItems = policy.maxQuantity;
    delete policy.maxQuantity;
  }
  if (policy.maxItemsPerOrder !== undefined) {
    policy.maxItems = policy.maxItemsPerOrder;
    delete policy.maxItemsPerOrder;
  }
  if (policy.maxPerItemQuantity !== undefined) {
    policy.maxItems = policy.maxPerItemQuantity;
    delete policy.maxPerItemQuantity;
  }
  if (policy.maxPerOrder === undefined && policy.maxTotal === undefined && policy.maxItems !== undefined) {
    // If only maxItems is set, infer maxTotal from maxPerItem * maxItems if maxPerItem exists
  }
  
  // Remove null/undefined fields
  Object.keys(policy).forEach(key => {
    if (policy[key] === null || policy[key] === undefined) {
      delete policy[key];
    }
  });
  
  // Default weekly budget if not specified
  if (policy.maxWeekly === undefined) {
    policy.maxWeekly = 300;
  }
  
  return policy;
}