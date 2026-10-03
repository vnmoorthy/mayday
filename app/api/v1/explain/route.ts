import { z } from "zod";
import { explainMatch } from "@/lib/data";
import { approachBody, json, preflight, readBody, route } from "@/lib/http";

export const dynamic = "force-dynamic";

// Same body as /approach (error is truncated at 4000 characters, vendor is
// optional), plus how many candidates to return.
const explainBody = approachBody.extend({
  limit: z.coerce.number().int().min(1).max(20).nullish(),
});

// Read-only: the scores Postgres computed for this error against the nearest
// crash sites, so anyone can see why it matched or did not. Nothing is logged.
export const POST = route(async (req) => {
  const input = await readBody(req, explainBody);
  return json(await explainMatch({ error: input.error, vendor: input.vendor, limit: input.limit ?? undefined }));
});

export const OPTIONS = preflight;
