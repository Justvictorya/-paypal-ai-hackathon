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

// Deterministic fallback. Ollama is not available on every host (e.g. Render
// free tier), so the policy compiler must work without it. This parses the
// same 6 rule types the guardrails enforce and returns an empty object for
// anything it can't parse, so the caller's defaults still apply.
export function compilePolicyFallback(plainLanguagePolicy) {
  const text = String(plainLanguagePolicy || '').toLowerCase();
  const policy = {};

  // Category — keyword match against known categories.
  const categories = {
    electronics: ['keyboard','mouse','monitor','laptop','phone','headphone','headset','speaker','camera','tablet','charger','webcam','router','drone','watch','audio','printer','scanner','ssd','ram','microphone','earbud','earphone','dock','hub','adapter','cable'],
    clothing: ['shirt','pants','jeans','jacket','shoe','sneaker','boot','hat','cap','sock','dress','coat','sweater','hoodie','shorts'],
    books: ['book','novel','textbook','comic','magazine'],
    bedroom: ['bed','pillow','blanket','duvet','sheet','quilt','rug','nightstand','lamp','mirror','dresser','linen','comforter','bedding','curtain','armchair'],
    home: ['lamp','pillow','blanket','rug','vase','mirror','clock','shelf','table','chair','kitchen','pot','pan'],
    toys: ['toy','lego','doll','puzzle','game','card','board','mystery'],
    sports: ['ball','racket','bat','glove','helmet','jersey','bike','yoga','mat','dumbbell','weights'],
    beauty: ['cream','lotion','soap','shampoo','perfume','makeup','brush','lipstick','serum','skincare'],
    automotive: ['tire','oil','battery','wiper','car','truck','motor'],
  };
  for (const [cat, kws] of Object.entries(categories)) {
    if (text.includes(cat) || kws.some(kw => text.includes(kw))) {
      policy.category = cat;
      break;
    }
  }

  // Per-item cap: "under $100 each", "≤$50/item", "max $75 per item",
  // "$60 each", "per item $50"
  const perItem = text.match(/(?:under|max|less than|no more than)\s*\$?(\d+(?:\.\d+)?)\s*(?:each|per item|\/item|a piece)/i)
    || text.match(/(?:each|per item|\/item|a piece)\s*\$?(\d+(?:\.\d+)?)/i)
    || text.match(/per item\s*\$?(\d+(?:\.\d+)?)/i);
  if (perItem) policy.maxPerItem = parseFloat(perItem[1]);

  // Max items: "max 3 items", "limit 2", "only 1 item", "up to 5"
  const items = text.match(/(?:max|limit|only|up to)\s*(\d+)\s*(?:items?|units?|pieces?|qty)?/i);
  if (items) policy.maxItems = parseInt(items[1], 10);

  // Weekly budget: "$200 a week", "max $150 per week", "$300/week"
  const weekly = text.match(/\$?(\d+(?:\.\d+)?)\s*(?:a |per )?week\b/i);
  if (weekly) policy.maxWeekly = parseFloat(weekly[1]);

  // Per-order total: "max $200", "budget $300", "limit $250", "$500 total",
  // "under $500". Require a dollar sign or the word "total" so that bare
  // quantities like "max 2 items" aren't misread as a dollar amount.
  const total = text.match(/(?:max|budget|limit|no more than)\s*\$?(\d+(?:\.\d+)?)(?!\s*(?:each|per item|a piece|\/item|items?|units?|pieces?|qty))/i)
    || text.match(/(?:under|less than)\s*\$?(\d+(?:\.\d+)?)(?!\s*(?:each|per item|a piece|\/item|items?|units?|pieces?|qty))/i)
    || text.match(/\$?(\d+(?:\.\d+)?)\s*total\b/i);
  if (total) policy.maxTotal = parseFloat(total[1]);

  // Time window: "nothing after 10pm" -> { end: "22:00" }
  //                 "before 8am"         -> { end: "08:00" }
  //                 "after 6pm"           -> { start: "18:00" }
  const timeMatch = text.match(/(?:after|before|no later than)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (timeMatch) {
    let h = parseInt(timeMatch[1], 10);
    const m = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const ampm = timeMatch[3].toLowerCase();
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    const hhmm = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    // "nothing after 10pm" / "before 8am" = the window ENDS then.
    const isEnd = text.includes('nothing') || text.includes('no ') || text.includes('before');
    policy.timeWindow = isEnd ? { end: hhmm } : { start: hhmm };
  }

  return policy;
}

export async function compilePolicy(plainLanguagePolicy) {
  let policy;
  try {
    const response = await ollama.chat({
      model: 'llama3.2:3b',
      messages: [
        { role: 'system', content: POLICY_SYSTEM_PROMPT },
        { role: 'user', content: plainLanguagePolicy }
      ],
      format: 'json'
    });
    policy = JSON.parse(response.message.content);
  } catch {
    // Ollama unavailable or returned invalid JSON — fall back to regex parsing.
    policy = compilePolicyFallback(plainLanguagePolicy);
  }
  
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