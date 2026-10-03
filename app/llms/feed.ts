import "server-only";
import { sortFlares } from "@/lib/mcp";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { Flare } from "@/lib/types";

// Shared by the /llms pitfall feeds and POST /api/v1/vaccine.

// The best flare at each site (vendor-pinned first, then helped - failed), in one
// query for all the sites.
export async function bestFlares(siteIds: string[]): Promise<Map<string, Flare>> {
  const best = new Map<string, Flare>();
  if (!siteIds.length) return best;
  const { data, error } = await supabaseAdmin().from("flares").select("*").in("site_id", siteIds).limit(2000);
  if (error) throw new Error(`bestFlares: ${error.message}`);
  for (const f of sortFlares((data ?? []) as Flare[])) {
    if (!best.has(f.site_id)) best.set(f.site_id, f);
  }
  return best;
}

// The public origin the request came in on, so feed URLs work on localhost,
// on previews and in production.
export function originOf(req: Request): string {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export const TEXT_HEADERS: Record<string, string> = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "public, max-age=120",
  "Access-Control-Allow-Origin": "*",
};

export function text(body: string, status = 200): Response {
  return new Response(body, { status, headers: TEXT_HEADERS });
}

// A fenced block that cannot be closed early by its own content.
export function fence(body: string): string {
  return "```\n" + body.replace(/```/g, "'''").trim() + "\n```";
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
