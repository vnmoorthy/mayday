import { NextResponse } from "next/server";
import { z } from "zod";
import { claimVendor, getVendor } from "@/lib/data";
import { safeStripeError, siteOrigin, stripeClient, stripeConfigured, vendorCustomer } from "@/lib/stripe";

export const dynamic = "force-dynamic";

const Body = z.object({ vendor: z.string().trim().min(1).max(64) });

// Claim an airspace. With Stripe configured this starts a Checkout Session for
// the metered pay-per-rescue subscription; without it the claim is immediate
// and labelled as demo so nobody mistakes it for a real payment.
export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON: { vendor }" }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "vendor is required" }, { status: 400 });

  try {
    const vendor = await getVendor(parsed.data.vendor.toLowerCase());
    if (!vendor) return NextResponse.json({ error: `Unknown airspace: ${parsed.data.vendor}` }, { status: 404 });

    if (!stripeConfigured()) {
      await claimVendor(vendor.slug);
      return NextResponse.json({ claimed: true, mode: "demo" });
    }

    // Already claimed through Checkout: do not open a second subscription.
    if (vendor.claimed && (await vendorCustomer(vendor.slug))) {
      return NextResponse.json({ claimed: true, mode: "test" });
    }

    const origin = siteOrigin(request);
    const slug = encodeURIComponent(vendor.slug);
    let url: string | null;
    try {
      const session = await stripeClient().checkout.sessions.create({
        mode: "subscription",
        // Metered prices take no quantity: usage comes from meter events.
        line_items: [{ price: process.env.STRIPE_PRICE_ID as string }],
        client_reference_id: vendor.slug,
        metadata: { vendor: vendor.slug },
        subscription_data: {
          description: `Pioneer tower for ${vendor.name}: pay per rescue`,
          metadata: { vendor: vendor.slug },
        },
        // {CHECKOUT_SESSION_ID} is filled in by Stripe and must stay unencoded.
        success_url: `${origin}/api/stripe/confirm?session_id={CHECKOUT_SESSION_ID}&vendor=${slug}`,
        cancel_url: `${origin}/tower/${slug}`,
      });
      url = session.url;
    } catch (err) {
      return NextResponse.json({ error: `Stripe could not start checkout: ${safeStripeError(err)}` }, { status: 502 });
    }
    if (!url) return NextResponse.json({ error: "Stripe returned a checkout session without a URL" }, { status: 502 });
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not claim airspace" }, { status: 500 });
  }
}
