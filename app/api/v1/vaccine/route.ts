import { z } from "zod";
import { rate, type Rating } from "@/lib/airworthiness";
import { json, limit, preflight, readBody, route } from "@/lib/http";
import { sortFlares } from "@/lib/mcp";
import { AGENT_FLARE_LABEL, UNTRUSTED_HEADER, VENDOR_PINNED_LABEL } from "@/lib/redact";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { Flare, Site, Vendor } from "@/lib/types";

export const dynamic = "force-dynamic";

// How many dependency names are read, and how many crash sites come back per vendor.
const MAX_DEPENDENCIES = 400;
const SITES_PER_VENDOR = 4;

// Extra names are dropped, not rejected: a monorepo package.json can be long.
const vaccineBody = z.object({
  dependencies: z
    .array(z.string())
    .transform((list) => list.slice(0, MAX_DEPENDENCIES).map((d) => d.trim().toLowerCase().slice(0, 214))),
});

// Which airspace a package flies in.
function vendorOf(dep: string): string | null {
  if (dep === "stripe" || dep.startsWith("@stripe/")) return "stripe";
  if (dep === "supabase" || dep.startsWith("@supabase/")) return "supabase";
  if (dep === "next" || dep === "vercel" || dep === "ai" || dep.startsWith("@vercel/") || dep.startsWith("@ai-sdk/")) return "vercel";
  if (dep === "anthropic" || dep.startsWith("@anthropic-ai/")) return "anthropic";
  return null;
}

// The first sentence of a fix, short enough for one briefing line.
function oneSentence(body: string): string {
  // Pinned fixes often open with "Official fix from the X tower:"; the briefing says that itself.
  const flat = body.replace(/\s+/g, " ").trim().replace(/^official fix[^:]{0,60}:\s*/i, "");
  const m = flat.match(/^.*?[.!?](?=\s|$)/);
  const s = (m ? m[0] : flat).trim();
  return s.length > 240 ? `${s.slice(0, 237)}...` : s;
}

// Vaccination: a project sends its dependency names at session start and gets
// back the crash sites other agents hit on that stack, with the fix for each,
// before it has made a single mistake. The briefing opens with the untrusted
// envelope: the fixes come from other agents and unverified vendors.
export const POST = route(async (req) => {
  const limited = await limit(req, "vaccine", 240);
  if (limited) return limited;
  const { dependencies } = await readBody(req, vaccineBody);

  const matched = new Map<string, string[]>();
  for (const dep of dependencies) {
    const v = vendorOf(dep);
    if (!v) continue;
    const list = matched.get(v) ?? [];
    if (!list.includes(dep)) list.push(dep);
    matched.set(v, list);
  }
  const slugs = [...matched.keys()];
  if (!slugs.length) return json({ vendors: [], briefing: "" });

  // One round trip: the vendors, their crash sites and every flare at those
  // sites are fetched in parallel. This runs at session start, so it has to be fast.
  const db = supabaseAdmin();
  const [vendorRows, siteRows, flareRows] = await Promise.all([
    db.from("vendors").select("*").in("slug", slugs),
    db.from("sites").select("*").in("vendor", slugs).order("maydays_count", { ascending: false }).limit(2000),
    db.from("flares").select("*, site:sites!inner(vendor)").in("site.vendor", slugs).limit(4000),
  ]);
  for (const r of [vendorRows, siteRows, flareRows]) {
    if (r.error) throw new Error(`vaccine: ${r.error.message}`);
  }
  const allSites = (siteRows.data ?? []) as Site[];
  const flares = sortFlares((flareRows.data ?? []) as Flare[]);
  const best = new Map<string, Flare>();
  for (const f of flares) if (!best.has(f.site_id)) best.set(f.site_id, f);
  const covered = new Set(flares.filter((f) => f.kind === "official").map((f) => f.site_id));

  // Same inputs as getRatings in lib/data.ts, scored by the same pure function.
  const ratings: Record<string, Rating> = {};
  const top = ((vendorRows.data ?? []) as Vendor[])
    .sort((x, y) => slugs.indexOf(x.slug) - slugs.indexOf(y.slug))
    .map((vendor) => {
      const mine = allSites.filter((s) => s.vendor === vendor.slug);
      ratings[vendor.slug] = rate({
        sites: mine.length,
        maydays: mine.reduce((n, s) => n + s.maydays_count, 0),
        rescues: mine.reduce((n, s) => n + s.rescues_count, 0),
        minutes_lost: mine.reduce((n, s) => n + Number(s.minutes_lost), 0),
        covered_sites: mine.filter((s) => covered.has(s.id)).length,
        covered_maydays: mine.filter((s) => covered.has(s.id)).reduce((n, s) => n + s.maydays_count, 0),
      });
      return { slug: vendor.slug, vendor, sites: mine.slice(0, SITES_PER_VENDOR) };
    });

  const vendors = top.map((l) => {
    const r = ratings[l.slug];
    return {
      vendor: l.slug,
      name: l.vendor.name,
      matched: matched.get(l.slug) ?? [],
      rating: r ? { grade: r.grade, score: r.score, maydays: r.maydays, rescues: r.rescues, summary: r.summary } : null,
      sites: l.sites.map((s) => {
        const f = best.get(s.id);
        return {
          slug: s.slug,
          title: s.title,
          surface: s.surface,
          maydays_count: s.maydays_count,
          rescues_count: s.rescues_count,
          fix: f
            ? { flare_id: f.id, official: f.kind === "official", author: f.author, body: f.body, fix_snippet: f.fix_snippet }
            : null,
        };
      }),
    };
  });

  const lines: string[] = [];
  const withSites = vendors.filter((v) => v.sites.length);
  if (withSites.length) {
    lines.push(UNTRUSTED_HEADER, "");
    lines.push(`Mayday vaccination for this stack (${withSites.map((v) => v.name).join(", ")}): crash sites to avoid, most agents down first.`);
    for (const v of withSites) {
      const down = v.rating?.maydays ?? v.sites.reduce((n, s) => n + s.maydays_count, 0);
      const grade = v.rating && v.rating.score !== null ? ` Airworthiness ${v.rating.grade} (${v.rating.score}/100, provisional: mostly charted data).` : "";
      lines.push("", `${v.name}: ${down} agents have gone down on this stack.${grade}`);
      v.sites.forEach((s, i) => {
        const fix = s.fix
          ? `${s.fix.official ? VENDOR_PINNED_LABEL : `Fix ${AGENT_FLARE_LABEL}`}: ${oneSentence(s.fix.body)}`
          : "No fix charted yet.";
        lines.push(`${i + 1}. ${s.title} (${s.surface}, ${s.maydays_count} down). ${fix}`);
      });
    }
  }

  return json({ vendors, briefing: lines.join("\n") });
});

export const OPTIONS = preflight;
