import "server-only";
import Stripe from "stripe";
import { claimVendor, markRescueBilled } from "@/lib/data";
import { supabaseAdmin } from "@/lib/supabase/server";

// Billing interface for Mayday (Stripe test mode, pay per rescue). Other
// modules only call billRescue and stripeConfigured; the rest is used by the
// routes under app/api/stripe.

export type BillResult = { billed: boolean; stripe_event?: string; reason?: string };

// True when STRIPE_SECRET_KEY and STRIPE_PRICE_ID are both set.
export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);
}

let client: Stripe | null = null;

// One Stripe client per server instance, created on first use so a missing
// key never breaks a build or an unrelated route.
export function stripeClient(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe is not configured: set STRIPE_SECRET_KEY.");
  client = new Stripe(key, {
    maxNetworkRetries: 1,
    timeout: 10_000,
    appInfo: { name: "mayday", version: "0.1.0" },
  });
  return client;
}

export function meterEventName(): string {
  return process.env.STRIPE_METER_EVENT_NAME?.trim() || "mayday_rescue";
}

// Error text that is safe to return to a caller: Stripe messages can echo part
// of a key, so anything shaped like one is scrubbed.
export function safeStripeError(err: unknown): string {
  const message = err instanceof Error ? err.message : "unknown error";
  return message.replace(/\b(sk|rk|pk|whsec)_[A-Za-z0-9_*]+/g, "[redacted]").slice(0, 300);
}

// Where Checkout sends the vendor back to. A localhost value left in the env
// must not send a deployed checkout back to localhost.
export function siteOrigin(request: Request): string {
  const fromRequest = new URL(request.url).origin;
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  if (!fromEnv) return fromRequest;
  const local = (u: string) => /\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(u);
  return local(fromEnv) && !local(fromRequest) ? fromRequest : fromEnv;
}

const idOf = (v: string | { id: string } | null | undefined): string | null =>
  !v ? null : typeof v === "string" ? v : v.id;

export type ClaimResult = { claimed: true; vendor: string } | { claimed: false; reason: string };

// Turns a finished Checkout Session into a claimed airspace. Called from both
// the confirm redirect and the webhook, so it has to be safe to run twice:
// claim_vendor upserts and keeps the first claimed_at.
export async function claimFromSession(session: Stripe.Checkout.Session, expectedVendor?: string): Promise<ClaimResult> {
  if (session.status !== "complete") return { claimed: false, reason: "Checkout was not completed" };
  const vendor = session.metadata?.vendor || session.client_reference_id;
  if (!vendor) return { claimed: false, reason: "Checkout session is not tied to an airspace" };
  if (expectedVendor && vendor !== expectedVendor) {
    return { claimed: false, reason: "Checkout session belongs to a different airspace" };
  }
  await claimVendor(vendor, {
    customer: idOf(session.customer),
    subscription: idOf(session.subscription),
    session: session.id,
  });
  return { claimed: true, vendor };
}

// The vendor's Stripe customer, or null when the airspace was never claimed
// through Checkout (unclaimed, or claimed in demo mode).
export async function vendorCustomer(vendorSlug: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("vendor_billing")
    .select("stripe_customer_id")
    .eq("vendor", vendorSlug)
    .maybeSingle();
  if (error) throw new Error(`vendor_billing: ${error.message}`);
  return (data?.stripe_customer_id as string | null | undefined) ?? null;
}

// Reports one billable rescue to Stripe as a meter event for the vendor's
// customer, then marks the rescue billed. Must never throw: a billing failure
// must not fail the rescue itself.
export async function billRescue(rescueId: string, vendorSlug: string): Promise<BillResult> {
  try {
    if (!stripeConfigured()) return { billed: false, reason: "stripe not configured (demo mode)" };
    const customer = await vendorCustomer(vendorSlug);
    if (!customer) return { billed: false, reason: "airspace has no Stripe customer" };

    // The rescue id is the meter event identifier, so a retried request can
    // never charge the vendor twice for the same rescue.
    let identifier = rescueId;
    try {
      const event = await stripeClient().billing.meterEvents.create({
        event_name: meterEventName(),
        payload: { stripe_customer_id: customer, value: "1" },
        identifier: rescueId,
      });
      identifier = event.identifier || rescueId;
    } catch (err) {
      // Stripe rejects a repeated identifier: the rescue is already metered.
      const message = err instanceof Error ? err.message : "";
      const duplicate = /identifier/i.test(message) && /already|exists|duplicate|unique/i.test(message);
      if (!duplicate) return { billed: false, reason: `stripe: ${safeStripeError(err)}` };
    }

    await markRescueBilled(rescueId, identifier);
    return { billed: true, stripe_event: identifier };
  } catch (err) {
    return { billed: false, reason: safeStripeError(err) };
  }
}
