import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";

// Which crash sites in a vendor's airspace already have an official fix
// pinned. lib/data.ts has no per-airspace view of this, and the tower table
// needs it for every row at once. A failure here must not take the tower
// down, so it degrades to "none pinned".
// Slugs of the vendors Pioneer itself has verified. vendor_stats does not carry
// the flag, and the leaderboard must never show a tower as verified by
// mistake, so any failure here degrades to "nobody is verified".
export async function getVerifiedVendorSlugs(): Promise<string[]> {
  try {
    const { data, error } = await supabaseAdmin().from("vendors").select("slug, verified").eq("verified", true).limit(500);
    if (error) return [];
    return (data ?? []).map((v) => String(v.slug));
  } catch {
    return [];
  }
}

export async function getOfficialFixSiteIds(vendor: string): Promise<string[]> {
  try {
    const { data, error } = await supabaseAdmin()
      .from("flares")
      .select("site_id, site:sites!inner(vendor)")
      .eq("kind", "official")
      .eq("site.vendor", vendor)
      .limit(2000);
    if (error) return [];
    return [...new Set((data ?? []).map((f) => String(f.site_id)))];
  } catch {
    return [];
  }
}
