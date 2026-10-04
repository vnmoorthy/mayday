import { reportMayday } from "@/lib/data";
import { json, limit, maydayBody, preflight, readBody, route } from "@/lib/http";

export const dynamic = "force-dynamic";

// Logs one stop signal and returns the briefing for the crash site it landed on.
// Public docs point at the alias /api/v1/signal; this path keeps working.
export const POST = route(async (req) => {
  const limited = await limit(req, "mayday", 240);
  if (limited) return limited;
  const input = await readBody(req, maydayBody);
  return json(await reportMayday(input), 201);
});

export const OPTIONS = preflight;
