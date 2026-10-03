import { NextResponse } from "next/server";
import { getBilling } from "@/lib/data";
import { stripeConfigured } from "@/lib/stripe";

export const dynamic = "force-dynamic";

// Billing summary for one airspace, plus whether rescues are really metered
// through Stripe (test mode) or only counted (demo mode).
export async function GET(_request: Request, { params }: { params: Promise<{ vendor: string }> }) {
  const { vendor } = await params;
  const slug = vendor.trim().toLowerCase();
  if (!slug || slug.length > 64) return NextResponse.json({ error: "Unknown airspace" }, { status: 404 });

  try {
    const billing = await getBilling(slug);
    if (!billing) return NextResponse.json({ error: `Unknown airspace: ${slug}` }, { status: 404 });
    const configured = stripeConfigured();
    return NextResponse.json({ ...billing, stripe: { configured, mode: configured ? "test" : "demo" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not load billing" }, { status: 500 });
  }
}
