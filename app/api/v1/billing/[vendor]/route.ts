import { NextResponse } from "next/server";
import { getBilling } from "@/lib/data";
import { stripeMode } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const DEFAULT_DAILY_CAP_CENTS = 2500;

// Billing summary for one airspace, plus whether rescues are really metered
// through Stripe or only counted (demo mode).
//
// This endpoint is public, so it never returns Stripe ids: has_customer and
// has_subscription say whether they exist. The two id fields stay in the
// response for older readers and are always null.
export async function GET(_request: Request, { params }: { params: Promise<{ vendor: string }> }) {
  const { vendor } = await params;
  const slug = vendor.trim().toLowerCase();
  if (!slug || slug.length > 64) return NextResponse.json({ error: "Unknown airspace" }, { status: 404 });

  try {
    const db = supabaseAdmin();
    // Same day boundary as the spend cap in record_rescue: midnight UTC.
    const midnight = new Date();
    midnight.setUTCHours(0, 0, 0, 0);

    const [billing, cap, today] = await Promise.all([
      getBilling(slug),
      db.from("vendor_billing").select("daily_cap_cents").eq("vendor", slug).maybeSingle(),
      db
        .from("rescues")
        .select("id, site:sites!inner(vendor)", { count: "exact", head: true })
        .eq("site.vendor", slug)
        .eq("billable", true)
        .gte("created_at", midnight.toISOString()),
    ]);
    if (!billing) return NextResponse.json({ error: `Unknown airspace: ${slug}` }, { status: 404 });
    if (cap.error) throw new Error(cap.error.message);
    if (today.error) throw new Error(today.error.message);

    const { stripe_customer_id, stripe_subscription_id, ...summary } = billing;
    const mode = stripeMode();
    return NextResponse.json(
      {
        ...summary,
        daily_cap_cents: (cap.data?.daily_cap_cents as number | null | undefined) ?? DEFAULT_DAILY_CAP_CENTS,
        billed_today_cents: (today.count ?? 0) * summary.rate_cents,
        has_customer: Boolean(stripe_customer_id),
        has_subscription: Boolean(stripe_subscription_id),
        stripe_customer_id: null,
        stripe_subscription_id: null,
        stripe: { configured: mode !== "demo", mode },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not load billing" }, { status: 500 });
  }
}
