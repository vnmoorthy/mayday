import { approach } from "@/lib/data";
import { approachBody, json, limit, preflight, readBody, route } from "@/lib/http";

export const dynamic = "force-dynamic";

// Read-only: what would an agent be told if it went down with this error?
export const POST = route(async (req) => {
  const limited = await limit(req, "approach", 600);
  if (limited) return limited;
  const input = await readBody(req, approachBody);
  return json(await approach(input));
});

export const OPTIONS = preflight;
