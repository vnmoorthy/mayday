import { reportLanding } from "@/lib/data";
import { HttpError, json, limit, preflight, readBody, route } from "@/lib/http";
import { landedBody } from "../schemas";

export const dynamic = "force-dynamic";

// An agent followed a route: did it land? Landings raise a route, failures sink it.
export const POST = route(async (req) => {
  const limited = await limit(req, "waggle-landed", 240);
  if (limited) return limited;
  const { route_id, ok, minutes } = await readBody(req, landedBody);
  const landed = await reportLanding(route_id, ok, minutes ?? 0);
  // report_landing returns an all-null row when no route has that id.
  if (!landed?.id) throw new HttpError(404, "route not found. Call POST /api/v1/waggle to get a route_id.");
  return json({ route: landed });
});

export const OPTIONS = preflight;
