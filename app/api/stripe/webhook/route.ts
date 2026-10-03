import { NextResponse } from "next/server";
import Stripe from "stripe";
import {
  claimFromSession,
  invoiceParties,
  releaseAirspace,
  restoreAirspace,
  stripeClient,
  stripeConfigured,
} from "@/lib/stripe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Stripe webhook: the subscription lifecycle of a claimed airspace.
//
//   checkout.session.completed      claim the airspace (the confirm redirect
//                                   does this too; this covers the vendor who
//                                   pays and closes the tab)
//   customer.subscription.deleted   release it: the vendor is no longer paying
//   invoice.payment_failed          release it: fixes stop being billable
//   invoice.paid                    give it back while the subscription runs
//
// Every handler is idempotent, because Stripe delivers events at least once
// and in no guaranteed order.
const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.deleted",
  "invoice.payment_failed",
  "invoice.paid",
]);

const idOf = (v: unknown): string | null => {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string") return (v as { id: string }).id;
  return null;
};

const done = (body: Record<string, unknown>) => NextResponse.json({ received: true, ...body });

export async function POST(request: Request) {
  // Signatures are computed over the exact bytes Stripe sent, so the body is
  // read as text and never re-serialised.
  const raw = await request.text();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let type: string;
  let object: { id?: unknown } | null;
  let verified = false;

  if (secret) {
    const signature = request.headers.get("stripe-signature");
    if (!signature) return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
    try {
      const event = await Stripe.webhooks.constructEventAsync(raw, signature, secret);
      type = event.type;
      object = event.data.object as { id?: unknown };
      verified = true;
    } catch {
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
    }
  } else {
    try {
      const event = JSON.parse(raw) as { type?: unknown; data?: { object?: { id?: unknown } } };
      if (typeof event.type !== "string") throw new Error("no type");
      type = event.type;
      object = event.data?.object ?? null;
    } catch {
      return NextResponse.json({ error: "Body is not a Stripe event" }, { status: 400 });
    }
  }

  if (!HANDLED.has(type)) return done({ handled: false });

  // Without a signing secret the payload cannot be trusted. Only the object's
  // id is taken from it, and the object is read back from Stripe, so a forged
  // event can at most make us look at what Stripe already says is true.
  const objectId = typeof object?.id === "string" ? object.id : "";
  const prefix = type === "checkout.session.completed" ? "cs" : type === "customer.subscription.deleted" ? "sub" : "in";
  if (!new RegExp(`^${prefix}_[A-Za-z0-9_]+$`).test(objectId)) {
    return NextResponse.json({ error: `Event has no ${prefix}_ object id` }, { status: 400 });
  }
  if (!verified && !stripeConfigured()) return done({ handled: false, reason: "stripe not configured" });

  try {
    if (type === "checkout.session.completed") {
      const session = verified
        ? (object as Stripe.Checkout.Session)
        : await stripeClient().checkout.sessions.retrieve(objectId);
      const result = await claimFromSession(session);
      return done({ handled: result.claimed, ...(result.claimed ? { vendor: result.vendor } : { reason: result.reason }) });
    }

    if (type === "customer.subscription.deleted") {
      const subscription = verified
        ? (object as Stripe.Subscription)
        : await stripeClient().subscriptions.retrieve(objectId);
      // Read back from Stripe, the subscription has to really be over.
      if (!verified && !["canceled", "unpaid", "incomplete_expired"].includes(subscription.status)) {
        return done({ handled: false, reason: `subscription is ${subscription.status}` });
      }
      const result = await releaseAirspace({ subscription: subscription.id, customer: idOf(subscription.customer) });
      return done(result.matched ? { handled: true, vendor: result.vendor, released: result.released } : { handled: false, reason: result.reason });
    }

    const invoice = verified ? (object as Stripe.Invoice) : await stripeClient().invoices.retrieve(objectId);

    if (type === "invoice.payment_failed") {
      // Read back from Stripe, the invoice has to still be unpaid after an attempt.
      if (!verified && (invoice.status === "paid" || invoice.status === "void" || !invoice.attempted)) {
        return done({ handled: false, reason: `invoice is ${invoice.status ?? "not attempted"}` });
      }
      const result = await releaseAirspace(invoiceParties(invoice));
      return done(result.matched ? { handled: true, vendor: result.vendor, released: result.released } : { handled: false, reason: result.reason });
    }

    // invoice.paid
    if (invoice.status !== "paid") return done({ handled: false, reason: `invoice is ${invoice.status ?? "unpaid"}` });
    if (!stripeConfigured()) return done({ handled: false, reason: "stripe not configured" });
    const result = await restoreAirspace(invoiceParties(invoice).subscription);
    return done(result.matched ? { handled: true, vendor: result.vendor, restored: result.restored } : { handled: false, reason: result.reason });
  } catch {
    // A 500 makes Stripe retry later, which is what we want if the database
    // or Stripe was briefly unreachable.
    return NextResponse.json({ error: "Could not apply the event" }, { status: 500 });
  }
}
