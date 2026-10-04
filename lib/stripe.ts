import "server-only";
import Stripe from "stripe";
import { claimVendor, markRescueBilled } from "@/lib/data";
import { supabaseAdmin } from "@/lib/supabase/server";

// Billing interface for Pioneer (Stripe test mode, pay per rescue). Other
// modules only call billRescue and stripeConfigured; the rest is used by the
// routes under app/api/stripe.

export type BillResult = { billed: boolean; stripe_event?: string; reason?: string };

// True when STRIPE_SECRET_KEY and STRIPE_PRICE_ID are both set.
export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);
}

export type StripeMode = "demo" | "test" | "live";

// "demo" when Stripe is not configured (rescues are counted, never charged),
// otherwise what the key itself says it is.
export function stripeMode(): StripeMode {
  if (!stripeConfigured()) return "demo";
  return /^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY ?? "") ? "live" : "test";
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
    appInfo: { name: "pioneer", version: "0.1.0" },
  });
  return client;
}

export function meterEventName(): string {
  return process.env.STRIPE_METER_EVENT_NAME?.trim() || "pioneer_rescue";
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

export type ReleaseResult =
  | { matched: true; vendor: string; released: boolean }
  | { matched: false; reason: string };

// Stripe object ids are letters, digits and underscores. Anything else is not
// an id and is never sent to the database.
const stripeId = (v: string | null | undefined): string | null => (v && /^[A-Za-z0-9_]{3,255}$/.test(v) ? v : null);

// The airspace a Stripe subscription or customer pays for. The subscription
// is the stronger match: an event for an old, replaced subscription must not
// touch a vendor that has since claimed again with a new one. The customer is
// used only when the event carries no subscription.
async function vendorForStripe(ids: { subscription?: string | null; customer?: string | null }): Promise<string | null> {
  const subscription = stripeId(ids.subscription);
  const customer = stripeId(ids.customer);
  const db = supabaseAdmin();
  if (subscription) {
    const { data, error } = await db.from("vendor_billing").select("vendor").eq("stripe_subscription_id", subscription).limit(1);
    if (error) throw new Error(`vendor_billing: ${error.message}`);
    return (data?.[0]?.vendor as string | undefined) ?? null;
  }
  if (customer) {
    const { data, error } = await db.from("vendor_billing").select("vendor").eq("stripe_customer_id", customer).limit(1);
    if (error) throw new Error(`vendor_billing: ${error.message}`);
    return (data?.[0]?.vendor as string | undefined) ?? null;
  }
  return null;
}

// The subscription ended or a payment failed: the airspace stops being
// claimed, so record_rescue stops marking rescues billable and leave_flare
// refuses new pinned fixes. Existing rescues and flares are left alone. Safe
// to run any number of times: the update only touches a vendor that is still
// claimed, and a repeat reports released: false.
export async function releaseAirspace(ids: { subscription?: string | null; customer?: string | null }): Promise<ReleaseResult> {
  const vendor = await vendorForStripe(ids);
  if (!vendor) return { matched: false, reason: "no airspace is billed through this subscription or customer" };
  const { data, error } = await supabaseAdmin()
    .from("vendors")
    .update({ claimed: false })
    .eq("slug", vendor)
    .eq("claimed", true)
    .select("slug");
  if (error) throw new Error(`vendors: ${error.message}`);
  return { matched: true, vendor, released: (data?.length ?? 0) > 0 };
}

export type RestoreResult =
  | { matched: true; vendor: string; restored: boolean }
  | { matched: false; reason: string };

// A later invoice was paid: give the airspace back, but only while the
// subscription on file is still running. The final invoice of a cancelled
// subscription is also "paid", and that must not re-claim anything, so the
// subscription's status is read from Stripe rather than assumed. claim_vendor
// keeps the first claimed_at, so this is idempotent too.
export async function restoreAirspace(subscriptionId: string | null): Promise<RestoreResult> {
  const subscription = stripeId(subscriptionId);
  if (!subscription) return { matched: false, reason: "invoice is not for a subscription" };
  const vendor = await vendorForStripe({ subscription });
  if (!vendor) return { matched: false, reason: "no airspace is billed through this subscription" };
  const { data, error } = await supabaseAdmin().from("vendors").select("claimed").eq("slug", vendor).maybeSingle();
  if (error) throw new Error(`vendors: ${error.message}`);
  if (data?.claimed) return { matched: true, vendor, restored: false };
  const current = await stripeClient().subscriptions.retrieve(subscription);
  if (current.status !== "active" && current.status !== "trialing") {
    return { matched: false, reason: `subscription is ${current.status}` };
  }
  await claimVendor(vendor);
  return { matched: true, vendor, restored: true };
}

// The customer and subscription an invoice belongs to. Older API versions put
// the subscription on the invoice itself; newer ones nest it under parent.
export function invoiceParties(invoice: unknown): { customer: string | null; subscription: string | null } {
  const inv = (invoice ?? {}) as {
    customer?: string | { id: string } | null;
    subscription?: string | { id: string } | null;
    parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null;
  };
  return {
    customer: idOf(inv.customer),
    subscription: idOf(inv.subscription) ?? idOf(inv.parent?.subscription_details?.subscription),
  };
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

    // The rescue id is the meter event identifier. A stop signal can be rescued
    // only once (unique index on rescues.mayday_id), so the rescue id is
    // exactly-once per failure: a retried request, or the reconcile job
    // running over the same rescue, can never charge the vendor twice.
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
