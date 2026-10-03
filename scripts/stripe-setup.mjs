// One-time Stripe setup for Mayday (test mode): the billing meter, the product
// and the metered price that "pay per rescue" runs on.
//
//   node --env-file=.env.local scripts/stripe-setup.mjs
//
// Safe to run again: everything is looked up before it is created.

import Stripe from "stripe";

const EVENT_NAME = process.env.STRIPE_METER_EVENT_NAME?.trim() || "mayday_rescue";
const PRODUCT_ID = "mayday_rescue";
const PRODUCT_NAME = "Mayday rescue";
const LOOKUP_KEY = "mayday_rescue_v1";
const RATE_CENTS = 25;

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY is not set. Add your test-mode secret key to .env.local and run:");
  console.error("  node --env-file=.env.local scripts/stripe-setup.mjs");
  process.exit(1);
}
// Mayday bills in test mode only; refuse to create live billing objects.
if (/^(sk|rk)_live_/.test(key)) {
  console.error("STRIPE_SECRET_KEY is a live key. Mayday runs in Stripe test mode: use a test-mode key.");
  process.exit(1);
}

const stripe = new Stripe(key, { appInfo: { name: "mayday-setup", version: "0.1.0" } });

async function ensureMeter() {
  for await (const meter of stripe.billing.meters.list({ status: "active", limit: 100 })) {
    if (meter.event_name === EVENT_NAME) return { meter, created: false };
  }
  const meter = await stripe.billing.meters.create({
    display_name: "Mayday rescues",
    event_name: EVENT_NAME,
    default_aggregation: { formula: "sum" },
    customer_mapping: { type: "by_id", event_payload_key: "stripe_customer_id" },
    value_settings: { event_payload_key: "value" },
  });
  return { meter, created: true };
}

async function ensureProduct() {
  try {
    const product = await stripe.products.retrieve(PRODUCT_ID);
    if (!product.active) await stripe.products.update(PRODUCT_ID, { active: true });
    return { product, created: false };
  } catch (err) {
    if (err?.code !== "resource_missing") throw err;
  }
  const product = await stripe.products.create({
    id: PRODUCT_ID,
    name: PRODUCT_NAME,
    description: "One agent rescued by an official fix pinned in a Mayday tower.",
    unit_label: "rescue",
  });
  return { product, created: true };
}

async function ensurePrice(productId, meterId) {
  const existing = await stripe.prices.list({ lookup_keys: [LOOKUP_KEY], active: true, limit: 1 });
  const current = existing.data[0];
  // Reuse the price only if it still points at this meter and rate; a price
  // cannot be edited, so anything else gets a new one that takes the lookup key.
  if (
    current &&
    current.recurring?.meter === meterId &&
    current.recurring?.usage_type === "metered" &&
    current.unit_amount === RATE_CENTS
  ) {
    return { price: current, created: false };
  }
  const price = await stripe.prices.create({
    product: productId,
    currency: "usd",
    unit_amount: RATE_CENTS,
    billing_scheme: "per_unit",
    nickname: "Pay per rescue",
    recurring: { interval: "month", usage_type: "metered", meter: meterId },
    lookup_key: LOOKUP_KEY,
    transfer_lookup_key: true,
  });
  return { price, created: true };
}

const mark = (created) => (created ? "created" : "exists ");

try {
  const { meter, created: meterCreated } = await ensureMeter();
  console.log(`meter    ${mark(meterCreated)}  ${meter.id}  event_name=${meter.event_name}`);

  const { product, created: productCreated } = await ensureProduct();
  console.log(`product  ${mark(productCreated)}  ${product.id}  "${product.name}"`);

  const { price, created: priceCreated } = await ensurePrice(product.id, meter.id);
  console.log(`price    ${mark(priceCreated)}  ${price.id}  $${(RATE_CENTS / 100).toFixed(2)} per rescue, billed monthly`);

  console.log("\nAdd these lines to .env.local (and to the deployment's environment):\n");
  console.log(`STRIPE_PRICE_ID=${price.id}`);
  console.log(`STRIPE_METER_EVENT_NAME=${EVENT_NAME}`);
  console.log("\nOptional, for the webhook (the confirm redirect already claims the airspace):");
  console.log("  stripe listen --forward-to localhost:3000/api/stripe/webhook");
  console.log("  then set STRIPE_WEBHOOK_SECRET to the whsec_ value it prints.");
} catch (err) {
  // Never print the key: Stripe redacts it in messages, and we scrub again.
  const message = String(err?.message ?? err).replace(/\b(sk|rk|whsec)_[A-Za-z0-9_*]+/g, "[redacted]");
  console.error(`Stripe setup failed: ${message}`);
  process.exit(1);
}
