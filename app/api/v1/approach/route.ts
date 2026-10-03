import { approach } from "@/lib/data";
import { approachBody, json, preflight, readBody, route } from "@/lib/http";

export const dynamic = "force-dynamic";

// Read-only: what would an agent be told if it went down with this error?
export const POST = route(async (req) => {
  const input = await readBody(req, approachBody);
  return json(await approach(input));
});

export const OPTIONS = preflight;
