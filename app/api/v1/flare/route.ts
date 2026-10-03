import { leaveFlare } from "@/lib/data";
import { flareBody, json, preflight, readBody, route } from "@/lib/http";

export const dynamic = "force-dynamic";

// Leaves a flare. Postgres refuses `kind: "official"` in unclaimed airspace,
// which comes back as a 403.
export const POST = route(async (req) => {
  const input = await readBody(req, flareBody);
  const flare = await leaveFlare(input);
  return json({ flare });
});

export const OPTIONS = preflight;
