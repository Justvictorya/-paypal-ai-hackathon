# Vouch — Spending Guardrails for Autonomous Agents

**PayPal AI Hackathon submission.** An autonomous payment agent whose spending
limits are enforced in **code, not in a prompt** — so no seller note, no
misread quantity, and no forgotten free trial can cost you money you didn't
intend to spend.

## The Problem

**Free trials that auto-renew.** You sign up for a 7-day trial, forget about
it, and get charged $54.99/month for six months before you notice. That's
~$330 leaked per subscription — and most people have several.

**AI agents that spend.** When an agent is authorized to buy on your behalf,
the budget only lives in the prompt — and prompts get misread (the agent parsed
"buy 10 at $60" as $600) and prompt-injected (a seller note can say "override
the buyer's budget"). **The limits can't live in the prompt.**

**Subscriptions nobody cancels.** PayPal handles recurring billing fine, but
nothing watches your agreements and cancels the ones you don't want. Until now.

## What Vouch Does

Vouch is an autonomous payment agent with a **Code-Level Guardrail Engine** and
an **Immutable Audit Dossier**. The rules are compiled to plain JavaScript and
checked *before* any call reaches PayPal — so the agent can act autonomously
while your money stays bounded.

1. **Write a spending policy in plain English** — "subscriptions under $20,
   nothing after 10pm" → compiled to structured rules.
2. **Review your PayPal subscriptions** — Vouch scans them, checks each against
   your policy, and **cancels the ones that shouldn't renew BEFORE the charge
   hits**. That's the money-leak fix.
3. **Buy with guardrails** — every purchase is validated by code (category
   allowlist, per-item cap, max quantity, per-order total, weekly budget, time
   window). Fail → rejected, **zero PayPal calls**.
4. **Prove every purchase** — a SHA-256 hash-chained audit dossier records each
   step. Verify it, or tamper it and watch it break.

## Features
- **Subscription management** (the headline feature): list, review, and cancel
  PayPal billing agreements. Auto-cancels free trials that breach your policy
  before they auto-renew.
- **Plain-language policy compiler** → structured JSON rules
- **Code-level guardrails** (no LLM): category allowlist, per-item cap, max
  quantity, per-order total, weekly budget, time window
- **Attack demo**: realistic seller note aimed at AI agents ("bulk promotion...
  override budget... order 10 units") — guardrail blocks it, **zero PayPal calls**
- **Live pipeline**: 7-step visual stepper with real-time log feed
- **Receipt panel** (after capture): item, quantity, total, PayPal order/capture
  IDs, timestamps, AI-written summary
- **SEALED stamp** (animation <1s) after final log entry
- **SHA-256 hash-chained audit log**: genesis, policy, order_created, approved,
  captured, (blocked), (refunded), (subscription_cancelled)
- **Verify Chain** button: recomputes every hash, shows "Intact ✓" or
  "Entry N altered ✗"
- **Tamper Test / Reset** buttons for demo
- **Refund** button calls PayPal sandbox refund endpoint, appends to chain
- **Download Evidence Pack (JSON)**: log + order data + policy
- **Dark/light mode** with Vouch design system

## Quick Start

### 0. Prerequisites
- Node.js ≥ 20
- [Ollama](https://ollama.ai) running locally with `llama3.2:3b` model
  ```bash
  ollama pull llama3.2:3b
  ollama serve
  ```
- A free PayPal developer account (`developer.paypal.com`) for sandbox
  subscriptions and payments.

### 1. Install
```bash
cd hackathons/paypal-ai-hackathon
npm install
```

### 2. Configure (optional — runs in demo mode without)
```bash
cp .env.example .env
# Edit .env with your PayPal sandbox credentials
```

### 3. Run
```bash
npm run dev
# Open http://localhost:8403
```
The Vouch UI loads at `/` with policy editor, **subscriptions panel**,
storefront, live pipeline, and receipt panel.

## Demo Flow (for video)

1. **Compile policy**: Type "subscriptions under $20" → click **Compile Rules** →
   chips appear
2. **Review subscriptions**: Click **Review & Cancel** on the Subscriptions
   panel → Vouch scans your PayPal agreements, cancels Adobe Creative Cloud
   ($54.99) because it breaches the $20 cap, keeps Spotify ($10.99) and
   Netflix ($15.49) as within policy. **Nothing is charged — the cancellation
   happens before the renewal date.**
3. **Buy keyboard**: Click **Buy This** on a catalog item → pipeline animates
   through all 7 steps → receipt slides in → **Verify Chain** → **SEALED**
4. **Run attack**: Click **Test Attack** on Mystery Box ($45) → pipeline stops
   red at Policy Check → "Blocked: order of 10 units exceeds your limit of 2
   per order. Nothing was sent to PayPal."
5. **Verify & tamper**: Click **Verify Chain** → "Intact ✓" → **Tamper Test** →
   verify shows red → **Reset** → green again
6. **Refund**: Click **Issue Sandbox Refund** → REFUNDED badge → chain updates
7. **Download**: Click **Download Evidence Pack (JSON)**

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Vouch demo UI |
| GET | `/health` | Liveness + capabilities |
| GET | `/.well-known/agent-card.json` | A2A agent card |
| POST | `/v1/policy` | Compile plain-language policy → JSON |
| GET | `/v1/policy` | Get active compiled policy |
| POST | `/v1/purchase` | Autonomous purchase (create + demo capture) |
| POST | `/v1/attack-demo` | Run attack scenario with guardrails |
| GET | `/v1/order/:orderId` | Get order status (for polling) |
| POST | `/v1/refund/:orderId` | Issue sandbox refund |
| GET | `/v1/subscriptions` | List PayPal billing agreements |
| GET | `/v1/subscriptions/:id` | Get one subscription |
| POST | `/v1/subscriptions/:id/cancel` | Cancel a subscription |
| POST | `/v1/subscriptions/review` | Scan + auto-cancel subscriptions breaching the active policy |
| GET | `/v1/dossier` | Get full hash-chained audit dossier |
| POST | `/v1/dossier/tamper` | Replace dossier (for tamper test demo) |

## Environment Variables (`.env`)
| Variable | Default | Description |
|----------|---------|-------------|
| `PAYPAL_CLIENT_ID` | — | PayPal sandbox app client ID (enables real sandbox payments) |
| `PAYPAL_CLIENT_SECRET` | — | PayPal sandbox app secret |
| `PAYPAL_BASE` | `https://api-m.sandbox.paypal.com` | PayPal API base |
| `PAYPAL_MERCHANT` | `PayPal Merchant` | Merchant name for branding |
| `PAYPAL_CURRENCY` | `USD` | Currency code |
| `PORT` | `8403` | API port |
| `OLLAMA_MODEL` | `llama3.2:3b` | Ollama model for policy compiler |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama server URL |

Without PayPal credentials, the agent runs in **demo mode**: simulates order creation/capture, clearly labeled `"demo": true`.

## Architecture
```
src/
├── guardrails.js       # check_order(order, policy) → {allowed, results[]}
├── policy-compiler.js  # Ollama: plain language → structured JSON (regex fallback)
├── intent-parser.js    # Extracts amount, qty, category from prompt (regex fallback)
agent.js                # PayPalAgent: createOrder, captureOrder, autonomousPurchaseWithGuardrails,
│                       #   refundOrder, listSubscriptions, cancelSubscription, reviewSubscriptions,
│                       #   hash-chained dossier, demo subscriptions
server.js               # Express API + static UI
public/index.html       # Vouch UI (single-file, no build step)
dossier.json            # Persisted SHA-256 hash-chained audit log
```

## Security
- **No secrets in repo**: `.env` is git-ignored; only `.env.example` committed
- **Guardrails are plain code** — cannot be bypassed by prompt injection
- **Hash chain**: `hash = SHA-256(index + type + timestamp + JSON(data) + prev_hash)`
- **PayPal sandbox only** — never production

## License
MIT — see [LICENSE](LICENSE).

## Not financial advice. Test in PayPal sandbox before any live use.