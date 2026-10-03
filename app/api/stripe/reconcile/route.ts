import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { limit } from "@/lib/http";
import { billRescue, stripeMode } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const BATCH = 200;
const WORKERS = 5;
// Stop starting new Stripe calls well before the function's time limit.
const BUDGET_MS = 45_000;

const noStore = { "Cache-Control": "no-store" };

// Compares two secrets without leaking where they differ.
function sameSecret(a: string, b: string): boolean {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(a), digest(b));
}

// Reconciliation: a rescue is metered to Stripe as it happens, but that call
// can fail (Stripe down, a timeout, the function killed mid-request) and the
// rescue itself must still succeed. Those rescues stay billable = true,
// billed = false. This job finds them, oldest first, and meters them again.
// It cannot double-charge: the rescue id is the meter event identifier, and
// Stripe refuses a repeated identifier.
//
// Vercel Cron calls this once a day with "Authorization: Bearer <CRON_SECRET>".
// When CRON_SECRET is not set (the hackathon demo) the route is open but
// rate-limited.
async function reconcile(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const given = request.headers.get("authorization") ?? "";
    if (!sameSecret(given, `Bearer ${secret}`)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
    }
  } else {
    const limited = await limit(request, "reconcile", 6);
    if (limited) return limited;
  }

  const mode = stripeMode();
  try {
    const db = supabaseAdmin();
    let query = db
      .from("rescues")
      .select("id, site:sites!inner(vendor)")
      .eq("billable", true)
      .eq("billed", false)
      .order("created_at", { ascending: true })
      .limit(BATCH);

    if (mode !== "demo") {
      // Only an airspace with a Stripe customer can be metered. Rescues from
      // airspaces claimed in demo mode would otherwise fill every batch and
      // starve the ones that can actually be billed.
      const { data: payers, error: payersError } = await db
        .from("vendor_billing")
        .select("vendor")
        .not("stripe_customer_id", "is", null);
      if (payersError) throw new Error(payersError.message);
      const vendors = (payers ?? []).map((p) => p.vendor as string);
      if (!vendors.length) return NextResponse.json({ checked: 0, billed: 0, still_unbilled: 0, mode }, { headers: noStore });
      query = query.in("site.vendor", vendors);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const pending = (data ?? []).map((row) => {
      const site = row.site as { vendor: string } | { vendor: string }[] | null;
      const vendor = Array.isArray(site) ? site[0]?.vendor : site?.vendor;
      return { id: row.id as string, vendor: vendor ?? "" };
    });
    const checked = pending.length;

    // Demo mode: nothing is ever sent to Stripe, so nothing is billed.
    if (mode === "demo") {
      return NextResponse.json({ checked, billed: 0, still_unbilled: checked, mode }, { headers: noStore });
    }

    let billed = 0;
    let next = 0;
    const deadline = Date.now() + BUDGET_MS;
    const worker = async () => {
      while (next < pending.length && Date.now() < deadline) {
        const rescue = pending[next++];
        if (!rescue.vendor) continue;
        // billRescue never throws; a failure just leaves the rescue for the next run.
        const result = await billRescue(rescue.id, rescue.vendor);
        if (result.billed) billed++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(WORKERS, pending.length) }, worker));

    return NextResponse.json({ checked, billed, still_unbilled: checked - billed, mode }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "Could not reconcile billing" }, { status: 500, headers: noStore });
  }
}

export const GET = reconcile;
export const POST = reconcile;
