import { getSiteDetail } from "@/lib/data";
import { HttpError, json, preflight, route } from "@/lib/http";

export const dynamic = "force-dynamic";

// One crash site by slug or id: flares, black boxes and rescues.
export const GET = route(async (_req: Request, ctx: { params: Promise<{ slug: string }> }) => {
  const { slug } = await ctx.params;
  const key = decodeURIComponent(slug).trim().slice(0, 200);
  const detail = key ? await getSiteDetail(key) : null;
  if (!detail) throw new HttpError(404, `Crash site "${key}" not found.`);
  return json(detail);
});

export const OPTIONS = preflight;
