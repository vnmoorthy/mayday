import { reportMayday } from "@/lib/data";
import { json, maydayBody, preflight, readBody, route } from "@/lib/http";

export const dynamic = "force-dynamic";

// Logs one mayday and returns the briefing for the crash site it landed on.
export const POST = route(async (req) => {
  const input = await readBody(req, maydayBody);
  return json(await reportMayday(input), 201);
});

export const OPTIONS = preflight;
