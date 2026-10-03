import { chartRoute } from "@/lib/data";
import { json, preflight, readBody, route } from "@/lib/http";
import { chartBody } from "../schemas";

export const dynamic = "force-dynamic";

// An agent found a way through that was not charted: leave it for the next one.
// Routes charted over HTTP are always source "live"; only the seed script
// writes "seed".
export const POST = route(async (req) => {
  const input = await readBody(req, chartBody);
  const charted = await chartRoute({
    task: input.task,
    vendor: input.vendor?.toLowerCase() || null,
    steps: input.steps,
    snippet: input.snippet ?? null,
    pitfalls: input.pitfalls ?? [],
    author: input.author ?? null,
    source: "live",
  });
  return json({ route: charted }, 201);
});

export const OPTIONS = preflight;
