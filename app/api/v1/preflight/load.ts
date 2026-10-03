import "server-only";
import { rate } from "@/lib/airworthiness";
import { getRating, getSites, getVendor } from "@/lib/data";
import { sortFlares, type Preflight } from "@/lib/mcp";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { Flare } from "@/lib/types";

// How many crash sites a preflight lists: enough to steer, short enough to read.
export const PREFLIGHT_SITES = 8;

// "Stripe", " stripe.svg " and "stripe" all mean the same airspace.
export function vendorSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\.(svg|json)$/, "")
    .slice(0, 64);
}

// The best flare at each site: official first, then helped - failed. One query
// for all the sites instead of one per site.
async function topFlares(siteIds: string[]): Promise<Map<string, Flare>> {
  const top = new Map<string, Flare>();
  if (!siteIds.length) return top;
  const { data, error } = await supabaseAdmin().from("flares").select("*").in("site_id", siteIds).limit(2000);
  if (error) throw new Error(`loadPreflight: ${error.message}`);
  for (const f of sortFlares((data ?? []) as Flare[])) {
    if (!top.has(f.site_id)) top.set(f.site_id, f);
  }
  return top;
}

// A vendor's rating plus the crash sites with the most maydays, each with the
// fix that got agents through. Shared by GET /api/v1/preflight/[vendor] and the
// mayday_preflight MCP tool. Null when the vendor does not exist.
export async function loadPreflight(slug: string, limit = PREFLIGHT_SITES): Promise<Preflight | null> {
  const vendor = await getVendor(slug);
  if (!vendor) return null;
  const [rating, all] = await Promise.all([getRating(slug), getSites(slug)]);
  // getSites already sorts by maydays_count, highest first.
  const sites = all.slice(0, limit);
  const top = await topFlares(sites.map((s) => s.id));
  return {
    vendor,
    rating: rating ?? rate({ maydays: 0, rescues: 0, minutes_lost: 0, sites: 0, covered_maydays: 0, covered_sites: 0 }),
    sites: sites.map((site) => ({ site, top_flare: top.get(site.id) ?? null })),
  };
}
