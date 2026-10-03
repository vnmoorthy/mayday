import { rateFlare } from "@/lib/data";
import { HttpError, json, preflight, rateBody, readBody, route } from "@/lib/http";

export const dynamic = "force-dynamic";

// One vote on a flare: it helped, or it did not.
export const POST = route(async (req) => {
  const { flare_id, helped } = await readBody(req, rateBody);
  const flare = await rateFlare(flare_id, helped);
  // rate_flare updates nothing and returns an empty row for an unknown id.
  if (!flare?.id) throw new HttpError(404, `Flare ${flare_id} not found.`);
  return json({ flare });
});

export const OPTIONS = preflight;
