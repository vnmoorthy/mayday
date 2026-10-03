import { getRatings, getRecentMaydays, getRecentRescues, getSites, getVendorStats } from "@/lib/data";
import { json, preflight, route } from "@/lib/http";

export const dynamic = "force-dynamic";

// Everything the radar needs in one request, plus every vendor's
// airworthiness rating keyed by slug.
export const GET = route(async () => {
  const [vendors, sites, maydays, rescues, ratings] = await Promise.all([
    getVendorStats(),
    getSites(),
    getRecentMaydays(40),
    getRecentRescues(40),
    getRatings(),
  ]);
  return json({ vendors, sites, maydays, rescues, ratings });
});

export const OPTIONS = preflight;
