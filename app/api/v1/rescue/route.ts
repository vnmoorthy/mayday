import { json, preflight, readBody, rescueBody, route } from "@/lib/http";
import { confirmRescue } from "./confirm";

export const dynamic = "force-dynamic";

// A flare got an agent through. Billable rescues are metered to the vendor.
export const POST = route(async (req) => {
  const input = await readBody(req, rescueBody);
  return json(await confirmRescue(input));
});

export const OPTIONS = preflight;
