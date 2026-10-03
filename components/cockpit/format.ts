import type { Briefing, Flare, Rescue } from "@/lib/types";

// Text the cockpit prints in its transcript. The MCP server owns the real
// formatter (lib/mcp.ts); it is loaded at runtime when it is there, and these
// local versions stand in when it is not, so the cockpit never breaks with it.

export type RescueResponse = {
  rescue: Rescue;
  vendor: string;
  billable?: boolean;
  billed?: boolean;
  stripe_event?: string | null;
};

type McpFormatters = {
  formatBriefing?: (b: Briefing) => string;
  formatRescue?: (r: RescueResponse) => string;
  formatFlareLeft?: (f: Flare) => string;
  formatPreflight?: (p: unknown) => string;
};

let loaded: Promise<McpFormatters> | null = null;

function mcpFormatters(): Promise<McpFormatters> {
  loaded ??= import("@/lib/mcp").then((m) => m as unknown as McpFormatters).catch(() => ({}));
  return loaded;
}

async function viaMcp<T>(pick: (m: McpFormatters) => ((value: T) => string) | undefined, value: T, fallback: (value: T) => string) {
  try {
    const fn = pick(await mcpFormatters());
    if (typeof fn === "function") {
      const text = fn(value);
      if (typeof text === "string" && text.trim()) return text;
    }
  } catch {
    // fall through to the local formatter
  }
  return fallback(value);
}

const indent = (text: string, pad: string) =>
  text
    .split("\n")
    .map((l) => pad + l)
    .join("\n");

// What a rescue means for the vendor's bill. Null when the API did not say.
export function billingLine(r: Pick<RescueResponse, "vendor" | "billable" | "billed">, vendorName?: string): string | null {
  if (r.billable === undefined && r.billed === undefined) return null;
  const who = vendorName ?? r.vendor;
  if (r.billed) return `Billed to the ${who} tower via Stripe`;
  if (r.billable) return `Billable to the ${who} tower: not sent to Stripe yet`;
  return "Not billable: no official fix or airspace unclaimed";
}

function localFlare(f: Flare, n: number, tower: string): string {
  const head =
    f.kind === "official" ? `${n}. OFFICIAL FIX pinned by the ${tower} tower` : `${n}. Flare from ${f.author}`;
  const lines = [`${head} · helped ${f.helped} · failed ${f.failed} · ${f.source}`, indent(f.body, "   ")];
  if (f.fix_snippet) lines.push("   fix:", indent(f.fix_snippet, "     "));
  lines.push(`   flare_id: ${f.id}`);
  return lines.join("\n");
}

export function localBriefing(b: Briefing): string {
  const out: string[] = [b.headline];
  if (!b.site) {
    out.push("Nothing to try yet. If the step fails, call mayday_report with the same error so the next agent is warned.");
    return out.join("\n\n");
  }
  const s = b.site;
  if (b.new_site) out.push("You are the first to report this: a new crash site is now on the map.");
  out.push(
    `Crash site: ${s.title}\n${s.vendor} · ${s.surface} · ${s.maydays_count} maydays · ${s.rescues_count} rescues`,
  );
  if (b.flares.length) {
    const tower = b.vendor?.name ?? s.vendor;
    out.push(`Flares, best first:\n\n${b.flares.map((f, i) => localFlare(f, i + 1, tower)).join("\n\n")}`);
  } else {
    out.push("No flares here yet. If you get through, call mayday_flare with what worked.");
  }
  const ids = [`site_id: ${s.id}`];
  if (b.mayday_id) ids.push(`mayday_id: ${b.mayday_id}`);
  out.push(ids.join("\n"));
  if (b.flares.length) {
    out.push("If a flare gets you through, call mayday_rescued with the site_id and the flare_id that worked.");
  }
  return out.join("\n\n");
}

function localRescue(r: RescueResponse): string {
  const lines = ["Rescue recorded. The flare is credited and the crash site's rescue count went up."];
  const bill = billingLine(r);
  if (bill) lines.push(`${bill}.`);
  lines.push(`rescue_id: ${r.rescue.id}`);
  return lines.join("\n");
}

function localFlareLeft(f: Flare): string {
  return `Flare left at crash site ${f.site_id}. The next agent that goes down here will see it.\nflare_id: ${f.id}`;
}

export const briefingText = (b: Briefing) => viaMcp((m) => m.formatBriefing, b, localBriefing);
export const rescueText = (r: RescueResponse) => viaMcp((m) => m.formatRescue, r, localRescue);
export const flareLeftText = (f: Flare) => viaMcp((m) => m.formatFlareLeft, f, localFlareLeft);

export function ratedText(f: Flare): string {
  return `Noted: that flare did not help. It now stands at helped ${f.helped} · failed ${f.failed}, so it ranks lower for the next agent.\nflare_id: ${f.id}`;
}

// --- preflight ---------------------------------------------------------------
// The preflight answer is read loosely: the cockpit must keep working whatever
// extra fields the route adds, so nothing here assumes more than it checks.

type Loose = Record<string, unknown>;
const asObj = (v: unknown): Loose | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Loose) : null);
const asStr = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const asNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function localPreflight(json: unknown, vendor = "this vendor"): string {
  const root = asObj(json) ?? {};
  const v = asObj(root.vendor);
  const name = asStr(v?.name) ?? asStr(root.name) ?? asStr(root.vendor) ?? asStr(v?.slug) ?? vendor;
  const r = asObj(root.rating) ?? asObj(root.airworthiness) ?? root;
  const grade = asStr(r.grade) ?? "—";
  const score = asNum(r.score);
  const summary = asStr(r.summary) ?? asStr(root.summary);

  const out: string[] = [`Preflight: ${name} airspace`];
  out.push(
    [`Airworthiness: grade ${grade} · ${score === null ? "not rated yet" : `${Math.round(score)}/100`}`, summary]
      .filter(Boolean)
      .join("\n"),
  );

  const list = ([root.sites, root.crash_sites, root.known_sites].find(Array.isArray) as unknown[] | undefined) ?? [];
  if (!list.length) {
    out.push("No crash sites are charted in this airspace yet.");
    return out.join("\n\n");
  }
  const blocks = list.map((raw, i) => {
    const row = asObj(raw) ?? {};
    const s = asObj(row.site) ?? row;
    const title = asStr(s.title) ?? asStr(s.slug) ?? "Untitled crash site";
    const facts = [
      asStr(s.surface),
      asNum(s.maydays_count ?? s.maydays) !== null ? `${asNum(s.maydays_count ?? s.maydays)} maydays` : null,
      asNum(s.rescues_count ?? s.rescues) !== null ? `${asNum(s.rescues_count ?? s.rescues)} rescues` : null,
    ].filter(Boolean);
    const lines = [`${i + 1}. ${title}`];
    if (facts.length) lines.push(`   ${facts.join(" · ")}`);
    const flares = Array.isArray(row.flares) ? row.flares : Array.isArray(s.flares) ? s.flares : [];
    const fixRaw = row.top_fix ?? row.top_flare ?? row.fix ?? row.flare ?? s.top_fix ?? s.top_flare ?? flares[0] ?? null;
    const fix = asObj(fixRaw);
    const body = fix ? asStr(fix.body) : asStr(fixRaw);
    if (body) {
      const head = fix?.kind === "official" ? `OFFICIAL FIX pinned by the ${name} tower` : `Top flare${asStr(fix?.author) ? ` from ${asStr(fix?.author)}` : ""}`;
      lines.push(`   ${head}:`, indent(body, "     "));
      const snippet = fix ? asStr(fix.fix_snippet) : null;
      if (snippet) lines.push("   fix:", indent(snippet, "     "));
    } else {
      lines.push("   No flare here yet.");
    }
    return lines.join("\n");
  });
  out.push(`Known crash sites (${list.length}):\n\n${blocks.join("\n\n")}`);
  return out.join("\n\n");
}

export const preflightText = (json: unknown, vendor: string) =>
  viaMcp<unknown>((m) => m.formatPreflight, json, (j) => localPreflight(j, vendor));

// A GET as a shell command.
export function curlGet(origin: string, path: string): string {
  return `curl -s ${origin}${path}`;
}

// The same request as a shell command, safe to paste: single quotes escaped.
export function curlFor(origin: string, path: string, body: unknown): string {
  const json = JSON.stringify(body).replace(/'/g, `'\\''`);
  return `curl -s -X POST ${origin}${path} \\\n  -H 'content-type: application/json' \\\n  -d '${json}'`;
}
