// Sends the payout once and checks what HivePay hands back.
import { sendPayout } from "./payout.mjs";

try {
  const payout = await sendPayout();
  const ok =
    payout &&
    typeof payout.id === "string" &&
    payout.id.startsWith("po_") &&
    payout.status === "paid" &&
    payout.amount === 4999 &&
    payout.currency === "usd";
  if (!ok) throw new Error(`The payout did not come back as expected: ${JSON.stringify(payout)}`);
} catch (err) {
  console.error(err);
  console.error("\nFAIL: the payout to the seller did not go through.");
  process.exit(1);
}

console.log("PASS: the seller was paid.");
