import { HttpError, json, limit, preflight, route } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const AIRSPACE = "hivepay-live";

// Empties the demo's own airspace so the first agent on /demo really is first.
// Only rows whose vendor is "hivepay-live" are touched: its routes and its
// crash sites (their stop signals, flares and rescues go with them by cascade).
export const POST = route(async (req) => {
  const limited = await limit(req, "demo-reset", 10);
  if (limited) return limited;

  const db = supabaseAdmin();
  const { error: vendorError } = await db.from("vendors").upsert(
    {
      slug: AIRSPACE,
      name: "HivePay",
      color: "#17130d",
      domains: ["hivepay.example"],
      claimed: true,
      claimed_at: new Date().toISOString(),
      verified: true,
    },
    { onConflict: "slug" },
  );
  if (vendorError) throw new HttpError(500, vendorError.message);

  const routes = await db.from("routes").delete({ count: "exact" }).eq("vendor", AIRSPACE);
  if (routes.error) throw new HttpError(500, routes.error.message);
  const sites = await db.from("sites").delete({ count: "exact" }).eq("vendor", AIRSPACE);
  if (sites.error) throw new HttpError(500, sites.error.message);

  return json({ ok: true, removed: { sites: sites.count ?? 0, routes: routes.count ?? 0 } });
});

export const OPTIONS = preflight;
