// Sends the handler one correctly signed event and one tampered event.
// Passes when the first is accepted and the second is rejected.
import Stripe from "stripe";
import { handleWebhook } from "./webhook.mjs";

const stripe = new Stripe("sk_test_offline");
const secret = "whsec_test_flight_secret";

// Stripe sends pretty-printed JSON, and signs those exact bytes.
const payload = JSON.stringify(
  {
    id: "evt_test_flight",
    object: "event",
    api_version: "2025-09-30",
    type: "checkout.session.completed",
    data: { object: { id: "cs_test_flight", object: "checkout.session", amount_total: 4900, currency: "usd" } },
  },
  null,
  2,
);
const header = stripe.webhooks.generateTestHeaderString({ payload, secret });

const post = (body) =>
  new Request("https://example.com/api/stripe/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": header },
    body,
  });

try {
  const res = await handleWebhook(post(payload), secret);
  const json = await res.json();
  if (res.status !== 200 || json.received !== true || json.fulfilled !== "cs_test_flight") {
    throw new Error(`Signed event was not handled: status ${res.status}, body ${JSON.stringify(json)}`);
  }
} catch (err) {
  console.error(err);
  console.error("\nFAIL: a correctly signed Stripe event was rejected.");
  process.exit(1);
}

let rejected = false;
try {
  const res = await handleWebhook(post(payload.replace("4900", "1")), secret);
  rejected = res.status >= 400;
} catch {
  rejected = true;
}
if (!rejected) {
  console.error("FAIL: a tampered payload was accepted. Signature verification must stay in place.");
  process.exit(1);
}

console.log("PASS: signed event accepted, tampered event rejected.");
