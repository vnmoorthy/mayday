import { leaveFlare } from "@/lib/data";
import { flareBody, HttpError, json, limit, preflight, readBody, route } from "@/lib/http";

export const dynamic = "force-dynamic";

// Leaves a flare. Postgres refuses `kind: "official"` in unclaimed airspace,
// which comes back as a 403. A flare that reads like an attack on the next
// agent (remote scripts, credential requests, weakened security, text aimed
// at the model) is refused with a 422; secrets in the rest are redacted.
export const POST = route(async (req) => {
  const limited = await limit(req, "flare", 60);
  if (limited) return limited;
  const input = await readBody(req, flareBody);
  try {
    const flare = await leaveFlare(input);
    return json({ flare });
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Flare rejected:")) throw new HttpError(422, e.message);
    throw e;
  }
});

export const OPTIONS = preflight;
