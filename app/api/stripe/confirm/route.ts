import { NextResponse } from "next/server";
import { claimFromSession, siteOrigin, stripeClient, stripeConfigured } from "@/lib/stripe";

export const dynamic = "force-dynamic";

// Stripe Checkout sends the vendor back here. The session is fetched from
// Stripe again (the query string proves nothing), the airspace is claimed, and
// the vendor lands on their tower. Every failure is a redirect with a
// readable claim_error, never a raw error page.
export async function GET(request: Request) {
  const origin = siteOrigin(request);
  const params = new URL(request.url).searchParams;
  const sessionId = params.get("session_id")?.trim() ?? "";
  const vendor = params.get("vendor")?.trim().toLowerCase() ?? "";

  // The vendor is only ever used as one path segment under our own origin.
  const validVendor = /^[a-z0-9][a-z0-9._-]{0,63}$/.test(vendor);
  const tower = validVendor ? `/tower/${encodeURIComponent(vendor)}` : "/tower";
  const back = (query: Record<string, string>) => {
    const url = new URL(tower, origin);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    return NextResponse.redirect(url, 303);
  };

  if (!validVendor) return back({ claim_error: "Missing airspace in the checkout return link" });
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return back({ claim_error: "Missing checkout session" });
  if (!stripeConfigured()) return back({ claim_error: "Stripe is not configured on this deployment" });

  try {
    const session = await stripeClient().checkout.sessions.retrieve(sessionId);
    const result = await claimFromSession(session, vendor);
    if (!result.claimed) return back({ claim_error: result.reason });
    return back({ claimed: "1" });
  } catch {
    return back({ claim_error: "Could not confirm the checkout with Stripe" });
  }
}
