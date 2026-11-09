// scripts/demo.js — End-to-end autonomous purchase demo (demo mode).
//
// Runs the full agent flow: create a PayPal order, then capture it, printing
// the result so judges can see one complete agent-to-merchant purchase.
// No PayPal credentials required (demo/simulated mode).

import PayPalAgent from "../agent.js";

const agent = new PayPalAgent({ demo: true });

async function main() {
  const purchase = await agent.autonomousPurchase({
    amount: "19.99",
    currency: "USD",
    merchant: "Zyng AI Market",
    description: "Autonomous AI agent purchase — demo",
    returnUrl: "https://example.com/return",
    cancelUrl: "https://example.com/cancel",
  });

  console.log(JSON.stringify(purchase, null, 2));

  if (purchase.status === "COMPLETED") {
    console.log("\nDemo complete: agent autonomously created + captured a PayPal order.");
  } else {
    console.log("\nOrder created. Direct buyer to approvalUrl, then capture:");
    console.log(`curl -X POST http://localhost:8403/v1/capture/${purchase.orderId}`);
  }
}

main().catch((err) => {
  console.error("demo failed:", err.message);
  process.exit(1);
});
