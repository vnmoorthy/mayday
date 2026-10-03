import { findRoutes, getRoutes, getSavings } from "@/lib/data";
import { json, preflight, readBody, route } from "@/lib/http";
import { waggleBody } from "./schemas";

export const dynamic = "force-dynamic";

// The waggle dance: "the good path is this way". POST a task and get the
// routes other agents have already landed, best match first.
export const POST = route(async (req) => {
  const { task, vendor, limit } = await readBody(req, waggleBody);
  const routes = await findRoutes({ task, vendor: vendor || null, limit });
  return json({ routes });
});

// Every charted route (optionally one vendor's), plus what the hive has saved.
export const GET = route(async (req) => {
  const vendor = new URL(req.url).searchParams.get("vendor")?.trim().toLowerCase().slice(0, 60) || undefined;
  const [routes, savings] = await Promise.all([getRoutes(vendor), getSavings()]);
  return json({ routes, savings });
});

export const OPTIONS = preflight;
