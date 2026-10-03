import { createClient } from "./sdk/hivepay.mjs";

const hivepay = createClient({ apiKey: process.env.HIVEPAY_API_KEY ?? "hp_test_offline" });

// Pays seller 8841 their $49.99 October payout. Returns the HivePay payout.
export async function sendPayout() {
  return hivepay.payouts.create(
    {
      amount: 49.99,
      currency: "usd",
      destination: "ba_tok_8f2c41d7a9",
      metadata: { reference: "October marketplace payout, seller 8841" },
    },
    { idempotencyKey: "idem-8841" },
  );
}
