import { HttpError, json, preflight, route } from "@/lib/http";
import { loadPreflight, vendorSlug } from "../load";

export const dynamic = "force-dynamic";

// What an agent should know before building on a vendor: the airworthiness
// rating and the crash sites with the most stop signals, each with its best flare.
export const GET = route(async (_req: Request, ctx: { params: Promise<{ vendor: string }> }) => {
  const { vendor } = await ctx.params;
  const slug = vendorSlug(decodeURIComponent(vendor));
  const result = slug ? await loadPreflight(slug) : null;
  if (!result) throw new HttpError(404, `Unknown airspace "${slug}". GET /api/v1/map lists every vendor.`);
  return json(result);
});

export const OPTIONS = preflight;
