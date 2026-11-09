# PayPal Autonomous Purchase Agent — PayPal AI Hackathon

An AI agent that **initiates and completes real purchases from PayPal-accepting merchants**.
Built for the **PayPal AI Hackathon** (deadline Nov 12, $67.5K).

## Problem

"Agent-to-merchant payments don't exist — an AI agent can't autonomously make a real purchase from a PayPal-accepting merchant. Most hacks just mention PayPal in a README."

This agent actually creates PayPal checkout orders and captures approved payments — an end-to-end agent-to-merchant purchase flow.

## Concept

1. Agent receives a purchase instruction (amount, merchant, description).
2. Agent creates a PayPal checkout order (`POST /v2/checkout/orders`, intent CAPTURE).
3. Buyer approves at the `approvalUrl` (PayPal sandbox checkout).
4. Agent captures the order (`POST /v2/checkout/orders/{id}/capture`) → purchase complete.
5. `POST /v1/purchase` combines create + capture; in demo mode the agent auto-approves and captures to show one complete flow.

## Tracks targeted

- **Agent-to-merchant payments** — autonomous purchase from a PayPal merchant.
- **Real AI + PayPal integration** — actual PayPal REST orders/captures, not a README mention.
- **MCP / A2A discoverability** — MCP server + agent card so other agents can find and call it.

## Files

| File | Purpose |
|------|---------|
| `server.js` | Express API: `/health`, `/.well-known/agent-card.json`, `POST /v1/checkout`, `POST /v1/capture/:orderId`, `POST /v1/purchase`, `GET /v1/order/:id` |
| `agent.js` | `PayPalAgent`: PayPal REST (sandbox) create/capture/get + demo mode |
| `mcp-server.js` | MCP server: `paypal_create_order`, `paypal_capture_order`, `paypal_get_order`, `paypal_autonomous_purchase` |
| `agent-card.json` | A2A agent card describing payment capabilities |
| `scripts/demo.js` | End-to-end autonomous purchase demo |
| `package.json` | Node/ESM package and scripts |

## Run it

### 0. Install
```bash
cd hackathons/paypal-ai-hackathon
npm install
```

### 1. Start the API
```bash
npm run dev
# Open http://localhost:8403/health
```

Health (free): `curl http://localhost:8403/health`

### 2. Run the autonomous purchase demo (no credentials needed — demo mode)
```bash
npm run demo
# -> agent creates + captures a $19.99 demo PayPal order
```

### 3. API flow
```bash
# Agent creates an order (demo mode auto-captures via /v1/purchase)
curl -X POST http://localhost:8403/v1/purchase \
  -H 'content-type: application/json' \
  -d '{"amount":"19.99","merchant":"Zyng AI Market","description":"Autonomous AI purchase"}'

# Real two-step flow (sandbox with credentials):
curl -X POST http://localhost:8403/v1/checkout \
  -H 'content-type: application/json' \
  -d '{"amount":"49.99","merchant":"Acme Store"}'
# -> returns orderId + approvalUrl; send buyer to approvalUrl
curl -X POST http://localhost:8403/v1/capture/<orderId>
# -> purchase complete

# A2A agent card
curl http://localhost:8403/.well-known/agent-card.json
```

### 4. MCP server
```bash
# stdio
node mcp-server.js

# HTTP
MCP_HTTP=1 MCP_PORT=3000 node mcp-server.js
```

Tools: `paypal_create_order`, `paypal_capture_order`, `paypal_get_order`, `paypal_autonomous_purchase`.

## Real PayPal sandbox payments

1. Create a PayPal developer app → get `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` (free, sandbox).
2. Set them and run:
```bash
PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... PAYPAL_MERCHANT="My Store" npm run dev
```
The agent then hits the real PayPal sandbox (`https://api-m.sandbox.paypal.com`) via OAuth client_credentials. Orders require buyer approval at `approvalUrl` before capture.

Optional remote PayPal MCP integration (per the verified PayPal dependency): set `PAYPAL_MCP_URL=https://mcp.paypal.com/sse` and `PAYPAL_ACCESS_TOKEN=...` to delegate create/capture to the remote PayPal MCP server.

## Environment

| Variable | Required | Purpose |
|----------|----------|---------|
| `PAYPAL_CLIENT_ID` | no | PayPal sandbox app client ID (enables real sandbox payments) |
| `PAYPAL_CLIENT_SECRET` | no | PayPal sandbox app secret |
| `PAYPAL_BASE` | no | PayPal API base (default `https://api-m.sandbox.paypal.com`) |
| `PAYPAL_MERCHANT` | no | Merchant name for branding (default "PayPal Merchant") |
| `PAYPAL_CURRENCY` | no | Currency code (default `USD`) |
| `PAYPAL_MCP_URL` | no | Remote PayPal MCP URL (default `https://mcp.paypal.com/sse`) |
| `PAYPAL_ACCESS_TOKEN` | no | Access token for the remote PayPal MCP |
| `PORT` | no | API port (default 8403) |
| `MCP_HTTP`, `MCP_PORT` | no | MCP HTTP server mode |

## Demo vs real

Without `PAYPAL_CLIENT_ID`/`PAYPAL_CLIENT_SECRET` the agent runs in **demo mode**: it simulates order creation and capture, clearly labeled `"demo": true`. This lets judges see one complete agent-to-merchant purchase without any PayPal signup. With credentials it performs **real PayPal sandbox payments**.

## Budget

Free tiers only. PayPal developer sandbox is free. No paid APIs, no paid RPCs.

## Not financial advice. Test in PayPal sandbox before any live use.
