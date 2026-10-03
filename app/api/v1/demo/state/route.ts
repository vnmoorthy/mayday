import { getFlights, getRoutes } from "@/lib/data";
import { HttpError, json, preflight, route } from "@/lib/http";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { Flare, Site } from "@/lib/types";

export const dynamic = "force-dynamic";

const AIRSPACE = "hivepay-live";
const SCENARIO = "hivepay-payout-live";

// What the hive knows about the demo airspace right now: its crash sites with
// their flares, its routes, and the last flights flown in it.
export const GET = route(async () => {
  const [sites, routes, flights] = await Promise.all([
    supabaseAdmin().from("sites").select("*, flares(*)").eq("vendor", AIRSPACE).order("first_seen", { ascending: true }).limit(50),
    getRoutes(AIRSPACE),
    getFlights(SCENARIO, 4),
  ]);
  if (sites.error) throw new HttpError(500, sites.error.message);
  const list = ((sites.data ?? []) as (Site & { flares: Flare[] | null })[]).map((s) => ({
    ...s,
    minutes_lost: Number(s.minutes_lost),
    flares: [...(s.flares ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at)),
  }));
  return json({ sites: list, routes, flights: flights.map((f) => ({ ...f, events: [] })) });
});

export const OPTIONS = preflight;
