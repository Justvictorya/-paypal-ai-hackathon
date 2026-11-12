import ollama from 'ollama';

const SYSTEM_PROMPT = `Extract purchase intent as JSON. Only output JSON.
Schema: { "amount": number, "currency": "USD", "maxItems": number, "category": string, "merchantHint": string }
Rules:
- amount = max total spend
- maxItems = quantity limit
- category = product type if mentioned
- merchantHint = store name if mentioned
- If unclear, use null`;

// Deterministic fallback parser. Ollama is not available on every host
// (e.g. Render free tier), and the LLM is unreliable on quantities anyway
// (it read "buy 10 at $60" as amount=600). This regex parser extracts the
// facts we actually need and returns null for anything it can't parse,
// so the caller can fall back to a policy default.
export function parseIntentFallback(userPrompt) {
  const text = String(userPrompt || '').toLowerCase();
  const result = { amount: null, currency: 'USD', maxItems: null, category: null, merchantHint: null };

  // Quantity: "10 units", "10x", "10 each", "ten units"
  const qtyMatch = text.match(/(?:buy|order|purchase)?\s*(\d+)\s*(?:x|units|items|pieces|qty)?/i)
    || text.match(/(\d+)\s*(?:x|units|items|pieces)/i);
  if (qtyMatch) result.maxItems = parseInt(qtyMatch[1], 10);

  // Unit price: "$60", "at $60", "60 dollars"
  const priceMatch = text.match(/(?:at|for|\$)\s*\$?(\d+(?:\.\d+)?)/);
  if (priceMatch) {
    const unit = parseFloat(priceMatch[1]);
    if (result.maxItems && result.maxItems > 1) {
      result.amount = Math.round(unit * result.maxItems);
    } else {
      result.amount = unit;
    }
  }

  // Total spend: "under $200", "max $200", "budget $200"
  const totalMatch = text.match(/(?:under|max|less than|budget|no more than)\s*\$?(\d+(?:\.\d+)?)/i);
  if (totalMatch) result.amount = parseFloat(totalMatch[1]);

  // Category keywords
  const categories = {
    electronics: ['keyboard','mouse','monitor','laptop','phone','headphone','headset','speaker','camera','tablet','charger','webcam','router','drone','watch','audio','printer','scanner','ssd','ram','microphone','earbud','earphone','dock','hub','adapter','cable','power bank','charger'],
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
    if (kws.some(kw => text.includes(kw))) {
      result.category = cat;
      break;
    }
  }

  return result;
}

export async function parseIntent(userPrompt) {
  try {
    const response = await ollama.chat({
      model: 'llama3.2:3b',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      format: 'json'
    });
    return JSON.parse(response.message.content);
  } catch {
    // Ollama unavailable or returned invalid JSON — fall back to regex parsing.
    return parseIntentFallback(userPrompt);
  }
}