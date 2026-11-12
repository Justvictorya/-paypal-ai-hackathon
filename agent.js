// agent.js — Autonomous PayPal payment agent.
//
import { parseIntent } from './src/intent-parser.js';
import { check_order } from './src/guardrails.js';
import { compilePolicy } from './src/policy-compiler.js';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const SANDBOX_BASE = "https://api-m.sandbox.paypal.com";
const DOSSIER_FILE = './dossier.json';

const DEMO_ORDER_PREFIX = "demo-";

function isDemo() {
  return !process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET;
}

async function clientCredentialsToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  const base = process.env.PAYPAL_BASE || SANDBOX_BASE;
  const auth = Buffer.from(`${clientId}:${secret}`).toString("base64");
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PayPal token failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.access_token;
}

async function paypalFetch(path, { method = "GET", body, token } = {}) {
  const base = process.env.PAYPAL_BASE || SANDBOX_BASE;
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  if (!res.ok) {
    throw new Error(`PayPal ${method} ${path} failed (${res.status}): ${JSON.stringify(json).slice(0, 300)}`);
  }
  return json;
}

function demoOrderId() {
  return `${DEMO_ORDER_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function demoCapture() {
  return {
    id: `CAP-${Date.now()}`,
    status: "COMPLETED",
    amount: { currency_code: "USD", value: "0.00" },
    create_time: new Date().toISOString(),
    update_time: new Date().toISOString(),
    links: [],
  };
}

export class PayPalAgent {
  constructor(opts = {}) {
    this.demo = opts.demo !== undefined ? opts.demo : isDemo();
    this.merchant = opts.merchant || process.env.PAYPAL_MERCHANT || "PayPal Merchant";
    this.currency = opts.currency || process.env.PAYPAL_CURRENCY || "USD";
    this.orders = new Map(); // in-memory demo order store
    this.subscriptions = [ // demo subscriptions (free trials that auto-renew)
      { id: 'I-ABC123', status: 'ACTIVE', product: 'Adobe Creative Cloud (7-day trial)', amount: 54.99, currency: 'USD', nextBillingDate: new Date(Date.now() + 2 * 86400000).toISOString(), billingInfo: { amount: { value: '54.99', currency_code: 'USD' } } },
      { id: 'I-DEF456', status: 'ACTIVE', product: 'Spotify Premium (30-day trial)', amount: 10.99, currency: 'USD', nextBillingDate: new Date(Date.now() + 1 * 86400000).toISOString(), billingInfo: { amount: { value: '10.99', currency_code: 'USD' } } },
      { id: 'I-GHI789', status: 'ACTIVE', product: 'Netflix Premium (free month)', amount: 15.49, currency: 'USD', nextBillingDate: new Date(Date.now() + 5 * 86400000).toISOString(), billingInfo: { amount: { value: '15.49', currency_code: 'USD' } } },
    ];
    this.dossier = []; // audit trail for tamper-evident logging
    this.lastHash = null; // hash chain for dossier integrity
    this.loadDossier();
  }

  loadDossier() {
    try {
      if (existsSync(DOSSIER_FILE)) {
        const data = JSON.parse(readFileSync(DOSSIER_FILE, 'utf8'));
        this.dossier = data;
        // Verify chain and set lastHash
        if (this.dossier.length > 0) {
          let verified = true;
          for (let i = 0; i < this.dossier.length; i++) {
            const entry = this.dossier[i];
            const prevHash = i === 0 ? null : this.dossier[i - 1].hash;
            const computedHash = this.hashChain(prevHash, entry.index, entry.type, entry.timestamp, entry.data);
            if (entry.hash !== computedHash || entry.prev_hash !== prevHash) {
              verified = false;
              break;
            }
          }
          this.lastHash = this.dossier[this.dossier.length - 1].hash;
          if (!verified) {
            console.warn('Dossier chain verification failed on load - possible tampering detected');
          }
        }
      }
    } catch {
      this.dossier = [];
      this.lastHash = null;
    }
  }

  saveDossier() {
    try {
      writeFileSync(DOSSIER_FILE, JSON.stringify(this.dossier, null, 2));
    } catch {
      /* ignore */
    }
  }

  // ---- Real PayPal REST -----------------------------------------------

  async createOrder(params) {
    const { amount, currency = this.currency, description, merchant = this.merchant, returnUrl, cancelUrl } = params;
    if (!amount) throw new Error("amount is required");
    if (this.demo) {
      const orderId = demoOrderId();
      const order = {
        id: orderId,
        status: "CREATED",
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: "autonomous-purchase",
            amount: { currency_code: currency, value: String(amount) },
            description: description || `Autonomous purchase from ${merchant}`,
          },
        ],
        payer: { name: { given_name: "AI", surname: "Agent" } },
        application_context: {
          return_url: returnUrl || "https://example.com/return",
          cancel_url: cancelUrl || "https://example.com/cancel",
          branding: { name: merchant },
        },
        links: [
          {
            rel: "approve",
            href: `https://sandbox.paypal.com/checkoutnow?token=${orderId}`,
            method: "GET",
          },
          { rel: "self", href: `https://api-m.sandbox.paypal.com/v2/checkout/orders/${orderId}`, method: "GET" },
        ],
        demo: true,
        createdAt: new Date().toISOString(),
      };
      this.orders.set(orderId, order);
      return { order, demo: true, approvalUrl: order.links[0].href };
    }

    const token = await clientCredentialsToken();
    const order = await paypalFetch("/v2/checkout/orders", {
      method: "POST",
      token,
      body: {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: "autonomous-purchase",
            amount: { currency_code: currency, value: String(amount) },
            description: description || `Autonomous purchase from ${merchant}`,
          },
        ],
        application_context: {
          return_url: returnUrl || "https://example.com/return",
          cancel_url: cancelUrl || "https://example.com/cancel",
          branding: { name: merchant },
          user_action: "PAY_NOW",
        },
      },
    });
    const approve = order.links?.find((l) => l.rel === "approve");
    return { order, demo: false, approvalUrl: approve ? approve.href : null };
  }

  async captureOrder(orderId) {
    if (this.demo) {
      const order = this.orders.get(orderId);
      if (!order) throw new Error(`Order not found: ${orderId}`);
      if (order.captured) throw new Error(`Order already captured: ${orderId}`);
      order.captured = true;
      order.status = "COMPLETED";
      const capture = { ...demoCapture(), amount: order.purchase_units[0].amount };
      this.orders.set(orderId, order);
      return { capture, order, demo: true };
    }

    const token = await clientCredentialsToken();
    const capture = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: "POST",
      token,
    });
    return { capture, demo: false };
  }

  async getOrder(orderId) {
    if (this.demo) {
      const order = this.orders.get(orderId);
      if (!order) throw new Error(`Order not found: ${orderId}`);
      return { order, demo: true };
    }
    const token = await clientCredentialsToken();
    const order = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, { method: "GET", token });
    return { order, demo: false };
  }

  // ---- Autonomous purchase: create + (demo) capture ------------------

async autonomousPurchase(params) {
    // If the caller passed an explicit order (amount/qty/category known),
    // use it directly instead of re-parsing the prompt through the LLM.
    // The guardrails already validated these exact facts, and the LLM is
    // unreliable on quantities (it read "buy 10 at $60" as amount=600).
    if (!params.amount && params.explicitOrder) {
      const eo = params.explicitOrder;
      params = {
        ...params,
        amount: eo.amount,
        currency: eo.currency || params.currency,
        merchant: eo.merchantHint || params.merchant,
      };
    }
    // Otherwise, if a natural-language prompt was passed, parse intent.
    if (!params.amount && params.prompt) {
      const intent = await parseIntent(params.prompt);
      // LLM often returns null for amount when the prompt is vague
      // (e.g. "buy a skincare set"). Fall back to the policy's maxTotal
      // so the order can still be created rather than throwing.
      const policyMax = params.policy && params.policy.maxTotal;
      const amount = intent.amount != null ? intent.amount
        : (policyMax != null ? policyMax : 25);
      params = {
        ...params,
        amount,
        currency: intent.currency || params.currency,
        merchant: intent.merchantHint || params.merchant,
      };
    }
    const created = await this.createOrder(params);
    const { amount, currency = this.currency, merchant = this.merchant } = params;

    if (this.demo) {
      // Auto-approve + capture in demo mode to show one complete flow.
      const captured = await this.captureOrder(created.order.id);
      return {
        demo: true,
        merchant,
        amount,
        currency,
        orderId: created.order.id,
        approvalUrl: created.approvalUrl,
        capture: captured.capture,
        status: "COMPLETED",
        note: "DEMO MODE — no real PayPal credentials. Set PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET for real sandbox payments.",
      };
    }

    // Real path: order created, awaiting buyer approval at approvalUrl.
    return {
      demo: false,
      merchant,
      amount,
      currency,
      orderId: created.order.id,
      approvalUrl: created.approvalUrl,
      status: "CREATED",
      note: "Order created. Direct the buyer to approvalUrl, then call POST /v1/capture/:orderId after approval.",
    };
  }

  // ---- Dossier & Guardrails ---------------------------------------------

  hashChain(prevHash, index, type, timestamp, data) {
    const str = `${index}${type}${timestamp}${JSON.stringify(data)}${prevHash || ''}`;
    return createHash('sha256').update(str).digest('hex');
  }

  createDossierEntry(type, data) {
    const index = this.dossier.length;
    const timestamp = new Date().toISOString();
    const prevHash = this.lastHash;
    const hash = this.hashChain(prevHash, index, type, timestamp, data);
    
    const entry = {
      index,
      type,
      timestamp,
      data,
      prev_hash: prevHash,
      hash
    };
    this.lastHash = hash;
    this.dossier.push(entry);
    this.saveDossier();
    return entry;
  }

  // ---- Policy Compiler Integration --------------------------------------

  async compileAndSetPolicy(plainLanguagePolicy) {
    const policy = await compilePolicy(plainLanguagePolicy);
    this.activePolicy = policy;
    return policy;
  }

  getActivePolicy() {
    return this.activePolicy || { maxTotal: 150, maxItems: 2 };
  }

  // ---- Guardrail Purchase -----------------------------------------------

  async autonomousPurchaseWithGuardrails(userPrompt, policy = {}, explicitOrder = null) {
    let intent;
    if (explicitOrder) {
      // Caller knows the exact amount/qty/category (e.g. UI custom-item buyer).
      // Skip LLM intent parsing — this avoids the LLM misreading natural
      // language into wrong amounts/quantities.
      intent = {
        amount: explicitOrder.amount,
        currency: explicitOrder.currency || this.currency,
        maxItems: explicitOrder.quantity || 1,
        category: explicitOrder.category || userPrompt,
        merchantHint: explicitOrder.merchantHint || 'Unknown Merchant',
      };
    } else {
      // 1. AI parses intent
      intent = await parseIntent(userPrompt);
    }

    // 2. Merge passed policy with active policy (active policy takes precedence for unset fields)
    const activePolicy = this.getActivePolicy();
    const mergedPolicy = { ...activePolicy, ...policy };
    // When the buyer explicitly types a custom item name (not a known catalog
    // product), allow unknown categories so the category allowlist doesn't
    // block a legitimate custom purchase. The numeric guardrails still apply.
    if (explicitOrder && explicitOrder.custom) mergedPolicy.allowUnknownCategory = true;

    // 3. Build order object for guardrail check
    const orderForGuardrail = {
      category: intent.category,
      unitPrice: intent.unitPrice || intent.amount,
      quantity: intent.maxItems || intent.quantity || 1,
      total: intent.amount
    };

    // 4. Code guardrail checks (CANNOT be bypassed by prompt injection)
    const guardrail = check_order(orderForGuardrail, mergedPolicy);
    if (!guardrail.allowed) {
      const failedRule = guardrail.results.find(r => !r.passed);
      const entry = this.createDossierEntry('blocked', { 
        intent, 
        guardrailResults: guardrail.results,
        failedRule,
        policy: mergedPolicy 
      });
      return {
        blocked: true,
        reason: 'guardrail_violation',
        guardrailResults: guardrail.results,
        failedRule,
        dossier: entry
      };
    }

    // 5. Normal purchase flow
    const result = await this.autonomousPurchase({
      amount: intent.amount,
      currency: intent.currency,
      merchant: intent.merchantHint || 'Unknown Merchant'
    });

    // 6. Add dossier entry
    const entry = this.createDossierEntry('purchase', { intent, result, policy: mergedPolicy, guardrailResults: guardrail.results });
    return { ...result, dossier: entry, guardrailResults: guardrail.results };
  }

  // ---- Refund (PayPal Agent Toolkit) ------------------------------------

  async refundOrder(orderId, amount = null) {
    if (this.demo) {
      // Demo mode: simulate refund
      const order = this.orders.get(orderId);
      if (!order) throw new Error(`Order not found: ${orderId}`);
      if (order.refunded) throw new Error(`Order already refunded: ${orderId}`);
      
      order.refunded = true;
      order.status = 'REFUNDED';
      const refund = {
        id: `REF-${Date.now()}`,
        status: 'COMPLETED',
        amount: { currency_code: 'USD', value: amount || order.purchase_units[0].amount.value },
        create_time: new Date().toISOString(),
      };
      this.orders.set(orderId, order);
      
      const entry = this.createDossierEntry('refund', { orderId, refund, amount: amount || order.purchase_units[0].amount.value });
      return { refund, order, demo: true, dossier: entry };
    }

    // Real sandbox: use PayPal Agent Toolkit or direct API
    try {
      const { PayPalAgentToolkit } = await import('@paypal/agent-toolkit');
      const toolkit = new PayPalAgentToolkit({
        clientId: process.env.PAYPAL_CLIENT_ID,
        clientSecret: process.env.PAYPAL_CLIENT_SECRET,
        sandbox: true
      });
      
      const refund = await toolkit.refund({
        orderId,
        amount: amount ? { value: String(amount), currency_code: 'USD' } : undefined
      });
      
      const entry = this.createDossierEntry('refund', { orderId, refund, amount: amount || refund.amount?.value });
return { refund, demo: false, dossier: entry };
    } catch (err) {
      // Fallback to direct API if toolkit fails
      const token = await clientCredentialsToken();
      const refund = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}/refund`, {
        method: 'POST',
        token,
        body: amount ? { amount: { value: String(amount), currency_code: 'USD' } } : {}
      });
      
      const entry = this.createDossierEntry('refund', { orderId, refund, amount: amount || refund.amount?.value });
      return { refund, demo: false, dossier: entry };
    }
  }

  // ---- Subscriptions (PayPal Billing Agreements) -------------------------
  // The real-world use case: free trials that auto-renew and leak money
  // because the subscriber forgot. Vouch watches subscriptions, checks each
  // one against the active spending policy, and cancels the ones that
  // shouldn't renew — BEFORE the charge hits.

  listSubscriptions() {
    if (this.demo) {
      return { demo: true, subscriptions: [...this.subscriptions] };
    }
    // Real path: PayPal Subscriptions API v1 (billing agreements)
    return (async () => {
      const token = await clientCredentialsToken();
      const data = await paypalFetch('/v1/billing/subscriptions', { method: 'GET', token });
      return { demo: false, subscriptions: data.items || [] };
    })();
  }

  getSubscription(subscriptionId) {
    if (this.demo) {
      const sub = this.subscriptions.find(s => s.id === subscriptionId);
      if (!sub) throw new Error(`Subscription not found: ${subscriptionId}`);
      return { demo: true, subscription: sub };
    }
    return (async () => {
      const token = await clientCredentialsToken();
      const sub = await paypalFetch(`/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: 'GET', token });
      return { demo: false, subscription: sub };
    })();
  }

  cancelSubscription(subscriptionId, reason = 'Cancelled by Vouch spending policy') {
    if (this.demo) {
      const sub = this.subscriptions.find(s => s.id === subscriptionId);
      if (!sub) throw new Error(`Subscription not found: ${subscriptionId}`);
      if (sub.status === 'CANCELLED') throw new Error(`Subscription already cancelled: ${subscriptionId}`);
      sub.status = 'CANCELLED';
      sub.cancelledAt = new Date().toISOString();
      sub.cancelReason = reason;
      const entry = this.createDossierEntry('subscription_cancelled', { subscriptionId, reason, subscription: sub });
      return { demo: true, subscription: sub, dossier: entry };
    }
    return (async () => {
      const token = await clientCredentialsToken();
      const sub = await paypalFetch(`/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
        method: 'POST', token,
        body: { reason }
      });
      const entry = this.createDossierEntry('subscription_cancelled', { subscriptionId, reason, subscription: sub });
      return { demo: false, subscription: sub, dossier: entry };
    })();
  }

  // Scan all subscriptions; cancel any whose next charge would breach the
  // active spending policy. Returns what was cancelled and why.
  // An optional policy override may be passed (e.g. from the review route);
  // when none is set, a conservative recurring-charge default is used so the
  // free-trial money-leak demo cancels something out of the box.
  async reviewSubscriptions(policyOverride) {
    // In demo mode reset each review so the auto-cancel demo is re-runnable
    // (a real PayPal agreement stays cancelled once cancelled). Reset before
    // listing so the scan sees fresh ACTIVE state, not a prior cancellation.
    if (this.demo) {
      this.subscriptions = this.subscriptions.map(s => ({
        ...s, status: 'ACTIVE', cancelledAt: undefined, cancelReason: undefined
      }));
    }
    const { subscriptions } = await this.listSubscriptions();
    const policy = policyOverride || this.getActivePolicy() || {};
    const effective = {
      maxTotal: policy.maxTotal ?? 50,
      maxPerItem: policy.maxPerItem ?? 20,
      maxItems: policy.maxItems ?? 5,
      maxWeekly: policy.maxWeekly ?? 200,
      timeWindow: policy.timeWindow ?? null,
      category: policy.category ?? null,
    };
    const now = new Date();
    const cancelled = [];
    const kept = [];

    for (const sub of subscriptions) {
      if (sub.status && sub.status !== 'ACTIVE') { kept.push({ sub, reason: `status=${sub.status}` }); continue; }
      const nextCharge = sub.nextBillingDate ? new Date(sub.nextBillingDate) : null;
      const daysUntil = nextCharge ? Math.round((nextCharge - now) / 86400000) : null;
      const amount = parseFloat(sub.billingInfo?.amount?.value || sub.amount || 0);

      // Cancel if the renewal is imminent and would breach the policy.
      const breaches = [];
      if (effective.maxTotal && amount > effective.maxTotal) breaches.push(`$${amount} exceeds max $${effective.maxTotal}`);
      if (effective.maxPerItem && amount > effective.maxPerItem) breaches.push(`$${amount} exceeds per-item cap $${effective.maxPerItem}`);

      if (daysUntil !== null && daysUntil <= 3 && breaches.length > 0) {
        await this.cancelSubscription(sub.id, `Policy breach: ${breaches.join('; ')}`);
        cancelled.push({ sub, reason: breaches.join('; '), daysUntil });
      } else {
        kept.push({ sub, reason: breaches.length ? `breaches policy but renews in ${daysUntil}d — left for review` : 'within policy', daysUntil });
      }
    }
    const entry = this.createDossierEntry('subscription_review', { total: subscriptions.length, cancelled: cancelled.length, kept: kept.length, cancelled, kept });
    return { demo: this.demo, total: subscriptions.length, cancelled, kept, dossier: entry };
  }

  capabilities() {
    return {
      name: "paypal-autonomous-purchase-agent",
      version: "1.0.0",
      demo: this.demo,
      sandboxBase: SANDBOX_BASE,
      methods: ["createOrder", "captureOrder", "getOrder", "autonomousPurchase", "autonomousPurchaseWithGuardrails", "compileAndSetPolicy", "refundOrder", "listSubscriptions", "getSubscription", "cancelSubscription", "reviewSubscriptions"],
      mcp: process.env.PAYPAL_MCP_URL ? "enabled" : "disabled",
    };
  }
}

export default PayPalAgent;
