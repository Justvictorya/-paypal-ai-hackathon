import { existsSync, readFileSync } from 'node:fs';

export function checkSpendLimit(intent, policy) {
  const violations = [];
  
  // Existing checks
  if (policy.maxTotal && intent.amount > policy.maxTotal) {
    violations.push({ rule: 'maxTotal', limit: policy.maxTotal, requested: intent.amount });
  }
  if (policy.maxPerItem && intent.amount > policy.maxPerItem) {
    violations.push({ rule: 'maxPerItem', limit: policy.maxPerItem, requested: intent.amount });
  }
  if (policy.maxItems && intent.maxItems > policy.maxItems) {
    violations.push({ rule: 'maxItems', limit: policy.maxItems, requested: intent.maxItems });
  }
  
  // New: category check
  if (policy.category && intent.category && intent.category.toLowerCase() !== policy.category.toLowerCase()) {
    violations.push({ 
      rule: 'category', 
      limit: policy.category, 
      requested: intent.category,
      message: `Category "${intent.category}" not allowed. Only "${policy.category}" permitted.`
    });
  }
  
  // New: time window check
  if (policy.timeWindow) {
    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();
    
    const parseTime = (t) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };
    
    const start = policy.timeWindow.start ? parseTime(policy.timeWindow.start) : 0;
    const end = policy.timeWindow.end ? parseTime(policy.timeWindow.end) : 24 * 60;
    
    if (currentTime < start || currentTime > end) {
      violations.push({ 
        rule: 'timeWindow', 
        limit: `${policy.timeWindow.start || '00:00'}–${policy.timeWindow.end || '23:59'}`,
        requested: `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`,
        message: `Current time outside allowed window (${policy.timeWindow.start || '00:00'}–${policy.timeWindow.end || '23:59'})`
      });
    }
  }
  
  // New: weekly spend check (requires dossier)
  if (policy.maxWeekly) {
    const weeklySpent = getWeeklySpend();
    if (weeklySpent + intent.amount > policy.maxWeekly) {
      violations.push({ 
        rule: 'maxWeekly', 
        limit: policy.maxWeekly, 
        requested: weeklySpent + intent.amount,
        message: `Would exceed weekly limit of $${policy.maxWeekly} (already spent $${weeklySpent} this week)`
      });
    }
  }
  
  return { allowed: violations.length === 0, violations };
}

function getWeeklySpend() {
  try {
    if (!existsSync('./dossier.json')) return 0;
    const dossier = JSON.parse(readFileSync('./dossier.json', 'utf8'));
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    
    return dossier
      .filter(e => e.type === 'purchase' && new Date(e.timestamp).getTime() > oneWeekAgo)
      .reduce((sum, e) => sum + (e.data.result?.amount || 0), 0);
  } catch {
    return 0;
  }
}