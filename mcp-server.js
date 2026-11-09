// mcp-server.js — MCP server exposing the PayPal autonomous purchase agent.
//
// Tools:
//   paypal_create_order      — create a PayPal order (agent initiates purchase)
//   paypal_capture_order     — capture an approved order
//   paypal_get_order         — fetch order details
//   paypal_autonomous_purchase — create + capture in one call (demo auto-captures)
//
// Modes:
//   stdio (default):  node mcp-server.js
//   HTTP:             MCP_HTTP=1 MCP_PORT=3000 node mcp-server.js
//
// Env: same as server.js (PAYPAL_CLIENT_ID/SECRET, PAYPAL_MERCHANT, ...)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { z } from "zod";
import PayPalAgent from "./agent.js";

const agent = new PayPalAgent();
const server = new McpServer(
  {
    name: "paypal-autonomous-purchase-agent",
    version: "1.0.0",
    description:
      "Autonomous PayPal payment agent. An AI agent that initiates and completes " +
      "real purchases from PayPal-accepting merchants. Creates PayPal orders, " +
      "captures approved orders, and runs a full autonomous purchase flow. " +
      (agent.demo ? "Running in DEMO mode (simulated orders). Set PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET for real sandbox payments." : ""),
  },
  { capabilities: { tools: {} } },
);

const baseSchema = {
  amount: z.string().describe("Purchase amount, e.g. '49.99'"),
  currency: z.string().optional().describe("Currency code (default USD)"),
  merchant: z.string().optional().describe("Merchant name for branding"),
  description: z.string().optional().describe("Order description"),
  returnUrl: z.string().optional().describe("Buyer return URL after approval"),
  cancelUrl: z.string().optional().describe("Buyer cancel URL"),
};

server.tool(
  "paypal_create_order",
  "Create a PayPal checkout order. Returns an orderId and an approvalUrl to send the buyer to.",
  baseSchema,
  async ({ amount, currency, merchant, description, returnUrl, cancelUrl }) => {
    const result = await agent.createOrder({ amount, currency, merchant, description, returnUrl, cancelUrl });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: !result.ok,
    };
  },
);

server.tool(
  "paypal_capture_order",
  "Capture an approved PayPal order to complete the purchase. Input: { orderId }.",
  {
    orderId: z.string().describe("PayPal order ID to capture"),
  },
  async ({ orderId }) => {
    const result = await agent.captureOrder(orderId);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: !result.ok,
    };
  },
);

server.tool(
  "paypal_get_order",
  "Fetch PayPal order details by ID. Input: { orderId }.",
  {
    orderId: z.string().describe("PayPal order ID"),
  },
  async ({ orderId }) => {
    const result = await agent.getOrder(orderId);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: !result.ok,
    };
  },
);

server.tool(
  "paypal_autonomous_purchase",
  "Run a full autonomous purchase: create a PayPal order and (in demo mode) capture it. In sandbox mode returns the order + approvalUrl for buyer approval.",
  baseSchema,
  async ({ amount, currency, merchant, description, returnUrl, cancelUrl }) => {
    const result = await agent.autonomousPurchase({ amount, currency, merchant, description, returnUrl, cancelUrl });
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: !result.ok,
    };
  },
);

async function runStdio() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("paypal-autonomous-purchase-agent MCP (stdio) ready");
}

async function runHttp() {
  const port = Number(process.env.MCP_PORT || 3000);
  const httpServer = createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/mcp") {
      const transport = new StreamableHTTPServerTransport();
      await transport.handleRequest(req, res);
      req.on("close", () => transport.close());
    } else {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    }
  });
  httpServer.listen(port, () => {
    console.error(`paypal-autonomous-purchase-agent MCP (HTTP) on http://localhost:${port}/mcp`);
  });
}

if (process.env.MCP_HTTP === "1") {
  runHttp().catch((err) => {
    console.error("MCP HTTP error:", err);
    process.exit(1);
  });
} else {
  runStdio().catch((err) => {
    console.error("MCP stdio error:", err);
    process.exit(1);
  });
}
