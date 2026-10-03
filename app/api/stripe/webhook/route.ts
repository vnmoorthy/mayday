import { NextResponse } from "next/server";
import Stripe from "stripe";
import { claimFromSession, stripeClient, stripeConfigured } from "@/lib/stripe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Stripe webhook. The confirm redirect already claims the airspace when the
// vendor comes back from Checkout; this covers the vendor who pays and closes
// the tab. Claiming is idempotent, so both paths can run.
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

  if (type !== "checkout.session.completed") return NextResponse.json({ received: true, handled: false });

  const sessionId = typeof object?.id === "string" ? object.id : "";
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    return NextResponse.json({ error: "Event has no checkout session id" }, { status: 400 });
  }

  try {
    let session: Stripe.Checkout.Session;
    if (verified) {
      session = object as Stripe.Checkout.Session;
    } else {
      // Without a signing secret the payload cannot be trusted, so only the
      // session id is taken from it and the session is read back from Stripe.
      if (!stripeConfigured()) return NextResponse.json({ received: true, handled: false, reason: "stripe not configured" });
      session = await stripeClient().checkout.sessions.retrieve(sessionId);
    }
    const result = await claimFromSession(session);
    return NextResponse.json({ received: true, handled: result.claimed, ...(result.claimed ? { vendor: result.vendor } : { reason: result.reason }) });
  } catch {
    // A 500 makes Stripe retry later, which is what we want if the database
    // was briefly unreachable.
    return NextResponse.json({ error: "Could not record the claim" }, { status: 500 });
  }
}
