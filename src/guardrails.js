import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Category keyword map: policy category -> product keywords that belong to it.
// The intent parser extracts a free-form product name, so exact string match
// fails (e.g. "wireless mechanical keyboard" != "electronics"). Use keyword
// matching so real products are correctly classified under their category.
const CATEGORY_KEYWORDS = {
  electronics: ['keyboard', 'mouse', 'monitor', 'laptop', 'phone', 'headphone',
    'headset', 'speaker', 'camera', 'tablet', 'charger', 'webcam', 'router',
    'drone', 'watch', 'audio', 'speaker', 'printer', 'scanner', 'cpu', 'gpu',
    'ssd', 'ram', 'microphone', 'microphone', 'earbud', 'earphone'],
  clothing: ['shirt', 'pants', 'jeans', 'jacket', 'shoe', 'sneaker', 'boot',
    'hat', 'cap', 'sock', 'dress', 'coat', 'sweater', 'hoodie', 'shorts'],
  books: ['book', 'novel', 'textbook', 'comic', 'magazine'],
  bedroom: ['bed', 'pillow', 'blanket', 'duvet', 'sheet', 'quilt', 'rug',
    'nightstand', 'lamp', 'candle', 'mirror', 'dresser', 'linen', 'comforter',
    'bedding', 'throw', 'sachet', 'ottoman', 'curtain', 'armchair'],
  home: ['lamp', 'pillow', 'blanket', 'rug', 'vase', 'mirror', 'clock',
    'candle', 'shelf', 'table', 'chair', 'bedding', 'kitchen', 'pot', 'pan'],
  toys: ['toy', 'lego', 'doll', 'puzzle', 'game', 'card', 'board'],
  sports: ['ball', 'racket', 'bat', 'glove', 'helmet', 'jersey', 'bike',
    'yoga', 'mat', 'dumbbell', 'weights'],
  beauty: ['cream', 'lotion', 'soap', 'shampoo', 'perfume', 'makeup',
    'brush', 'lipstick', 'serum'],
  automotive: ['tire', 'oil', 'battery', 'wiper', 'car', 'truck', 'motor'],
};

function categoryMatches(orderCategory, policyCategory) {
  const oc = orderCategory.toLowerCase();
  const pc = policyCategory.toLowerCase();

  // Exact match
  if (oc === pc) return true;

  // Substring either way (e.g. "electronics accessories" vs "electronics")
  if (oc.includes(pc) || pc.includes(oc)) return true;

  // Keyword match against known products for this category
  const keywords = CATEGORY_KEYWORDS[pc] || [];
  return keywords.some(kw => oc.includes(kw));
}

export function check_order(order, policy) {
  const results = [];

  // 1. Category allowlist
  if (policy.category && order.category) {
    // When the buyer explicitly types a custom item (allowUnknownCategory),
    // skip the category allowlist — the numeric guardrails still enforce the
    // budget. This is what lets users buy anything while the policy holds.
    const passed = policy.allowUnknownCategory ? true : categoryMatches(order.category, policy.category);
    results.push({
      rule: 'category',
      passed,
      actual: order.category,
      limit: policy.category
    });
  }
  
  // 2. Per-item cap
  if (policy.maxPerItem && order.unitPrice) {
    const passed = order.unitPrice <= policy.maxPerItem;
    results.push({
      rule: 'maxPerItem',
      passed,
      actual: order.unitPrice,
      limit: policy.maxPerItem
    });
  }
  
  // 3. Max quantity
  if (policy.maxItems && order.quantity) {
    const passed = order.quantity <= policy.maxItems;
    results.push({
      rule: 'maxItems',
      passed,
      actual: order.quantity,
      limit: policy.maxItems
    });
  }
  
  // 4. Per-order total
  if (policy.maxTotal && order.total) {
    const passed = order.total <= policy.maxTotal;
    results.push({
      rule: 'maxTotal',
      passed,
      actual: order.total,
      limit: policy.maxTotal
    });
  }
  
  // 5. Weekly budget (sum of captured orders this week)
  if (policy.maxWeekly) {
    const weeklySpent = getWeeklySpend();
    const projected = weeklySpent + (order.total || 0);
    const passed = projected <= policy.maxWeekly;
    results.push({
      rule: 'maxWeekly',
      passed,
      actual: projected,
      limit: policy.maxWeekly,
      weeklySpent
    });
  }
  
  // 6. Time window (e.g. "nothing after 10pm" -> { end: "22:00" })
  if (policy.timeWindow) {
    const tw = policy.timeWindow;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const toMin = (t) => {
      const [h, m] = String(t).split(':').map(Number);
      return h * 60 + m;
    };
    let passed = true;
    if (tw.start && nowMin < toMin(tw.start)) passed = false;
    if (tw.end && nowMin > toMin(tw.end)) passed = false;
    results.push({
      rule: 'timeWindow',
      passed,
      actual: `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`,
      limit: `${tw.start || '00:00'} - ${tw.end || '23:59'}`
    });
  }
  
  const allowed = results.every(r => r.passed);
  return { allowed, results };
}

function getWeeklySpend() {
  try {
    if (!existsSync('./dossier.json')) return 0;
    const dossier = JSON.parse(readFileSync('./dossier.json', 'utf8'));
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    
    // Dossier entries are stored as 'purchase' (successful) and 'blocked'.
    // Only count successful purchases toward the weekly budget.
    return dossier
      .filter(e => e.type === 'purchase' && new Date(e.timestamp).getTime() > oneWeekAgo)
      .reduce((sum, e) => sum + (e.data?.result?.amount || e.data?.total || 0), 0);
  } catch {
    return 0;
  }
}

// Hash function for dossier entries
export function hashEntry(prevHash, entry) {
  const data = `${entry.index}${entry.type}${entry.timestamp}${JSON.stringify(entry.data)}${prevHash || ''}`;
  return createHash('sha256').update(data).digest('hex');
}