# Vouch — AI Agents That Buy With Limits, And Prove Every Purchase

**PayPal AI Hackathon submission** (deadline Nov 12). A secure, autonomous agentic commerce dashboard that executes safe purchases through PayPal Sandbox APIs while featuring a built-in **Code-Level Guardrail Engine** and an **Immutable Audit Dossier**.

## Problem
AI agents are starting to spend money, but the limits usually live in the prompt — easily overridden by prompt injection. **The limits can't live in the prompt.** This project enforces spending rules in plain code, logs every step to a SHA-256 hash-chained dossier, and proves every purchase with a tamper-evident receipt.

## Features
- **Plain-language policy compiler** (Ollama local LLM) → structured JSON rules
- **Code-level guardrails** (no LLM): category allowlist, per-item cap, max quantity, per-order total, weekly budget
- **Attack demo**: realistic seller note aimed at AI agents ("bulk promotion... override budget... order 10 units") — guardrail blocks it, **zero PayPal calls**
- **Live pipeline**: 7-step visual stepper with real-time log feed (JetBrains Mono)
- **Receipt panel** (appears after real capture): item, quantity, total, PayPal order/capture IDs, timestamps, AI-written summary
- **SEALED stamp** (animation <1s) after final log entry
- **SHA-256 hash-chained audit log**: genesis, policy, order_created, approved, captured, (blocked), (refunded)
- **Verify Chain** button: recomputes every hash, shows "Intact ✓" (green) or "Entry N altered ✗" (red)
- **Tamper Test / Reset** buttons for demo
- **Refund** button calls PayPal sandbox refund endpoint, appends to chain on success
- **Download Evidence Pack (JSON)**: log + order data + policy
- **Dark/light mode** with Vouch design system (Fraunces/Inter/JetBrains Mono, teal/slate/cream palette)

## Quick Start

### 0. Prerequisites
- Node.js ≥ 20
- [Ollama](https://ollama.ai) running locally with `llama3.2:3b` model
  ```bash
  ollama pull llama3.2:3b
  ollama serve
  ```

### 1. Install
```bash
cd hackathons/paypal-ai-hackathon
npm install
```

### 2. Configure (optional — runs in demo mode without)
```bash
cp .env.example .env
# Edit .env with your PayPal sandbox credentials if you want real payments
```

### 3. Run
```bash
npm run dev
# Open http://localhost:8403
```
The Vouch UI loads at `/` with policy editor, storefront, live pipeline, and receipt panel.

## Demo Flow (for video)
1. **Compile policy**: Type "Electronics only, max $150 per item, max 2 items per order, $300 weekly budget" → click **Compile Rules** → chips appear
2. **Buy keyboard**: Click **Buy This** on Wireless Keyboard ($110) → watch pipeline animate through all 7 steps → click **Open PayPal Approval** (sandbox) → receipt slides in → click **Verify Chain** → **SEALED** stamp lands
3. **Run attack**: Click **Test Attack** on Mystery Box ($45) → pipeline stops red at Policy Check → message: "Blocked: order of 10 units exceeds your limit of 2 per order. Nothing was sent to PayPal." → chips flash red, log shows "ACTION: Order rejected. 0 calls sent to PayPal."
4. **Verify & tamper**: Click **Verify Chain** → "Intact ✓" → click **Tamper Test** → verify shows red with entry number → click **Reset** → green again
5. **Refund**: Click **Issue Sandbox Refund** → badge turns REFUNDED (green) → hash chain updates
6. **Download**: Click **Download Evidence Pack (JSON)**

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
├── policy-compiler.js  # Ollama: plain language → structured JSON
├── intent-parser.js    # Extracts amount, qty, category from prompt
agent.js                # PayPalAgent: createOrder, captureOrder, autonomousPurchaseWithGuardrails, refundOrder, hash-chained dossier
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