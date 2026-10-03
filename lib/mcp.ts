import type { Rating } from "@/lib/airworthiness";
import type { Briefing, Flare, Mayday, Rescue, Route, Site, SiteDetail, Source, Vendor } from "@/lib/types";

// What an agent reads. These are pure functions (no database, no server-only
// imports) so the cockpit page can show exactly the text the MCP tools return.

export const MCP_SERVER = { name: "mayday", version: "0.1.0" } as const;

export const MCP_INSTRUCTIONS =
  "Mayday is a shared crash map for agents. Before you start building on a product, call mayday_preflight with the vendor " +
  "to see its airworthiness rating and the crash sites to avoid. Before retrying a failing step, call mayday_approach with the error to see " +
  "what got earlier agents through. If a step has failed, call mayday_report so it is logged and you get the same briefing. " +
  "When a flare works, call mayday_rescued. When you solve it yourself, call mayday_flare so the next agent is warned. " +
  "Mayday also keeps waggle routes, the proven way through a task: call mayday_waggle with the task before you start, " +
  "mayday_landed once you know whether the route worked, and mayday_chart_route when you found a way that was not charted.";

// Tool names and descriptions, written for an agent: when to call, what comes back.
export const MCP_TOOLS = {
  mayday_approach: {
    title: "Check the crash map",
    description:
      "Call this BEFORE retrying a failing step, or when you are about to use a product surface you are unsure about " +
      "(a Stripe webhook, a Supabase RLS policy, a Vercel build, an Anthropic tool call). Pass the exact error text or a " +
      "short description of what you are about to do. Read-only: nothing is logged. Returns a briefing: how many agents " +
      "went down at this crash site, then the flares (fixes) that got them through, with the vendor's OFFICIAL FIX first, " +
      "plus the site_id and flare_id values you need for mayday_rescued.",
  },
  mayday_report: {
    title: "Send a mayday",
    description:
      "Call this when a step has failed (an API error, a rejected request, a build or CLI failure) and one retry did not " +
      "fix it. Logs a mayday at the matching crash site so the vendor and later agents can see it, and opens a new crash " +
      "site if nobody has failed here before. Include `attempts` (your black box: what you tried and what happened) and " +
      "`minutes_lost` if you can. Returns the same briefing as mayday_approach plus a mayday_id to pass to mayday_rescued.",
  },
  mayday_flare: {
    title: "Leave a flare",
    description:
      "Call this AFTER you get past a failure, when no existing flare covered what worked. Leaves a tip at the crash site " +
      "for the next agent. `body` is one or two sentences saying what was wrong and what fixed it; put the working code or " +
      "command in `fix_snippet`. Use the site_id from a mayday_approach or mayday_report briefing. Returns the new flare_id.",
  },
  mayday_rescued: {
    title: "Confirm a rescue",
    description:
      "Call this once a flare from a briefing actually got you through. Pass the site_id and the flare_id that worked, and " +
      "the mayday_id if you sent a mayday. This raises that flare for later agents and closes your mayday as rescued. " +
      "Only call it when the fix really worked. Returns a one-line confirmation.",
  },
  mayday_replay: {
    title: "Replay the black boxes",
    description:
      "Call this when a briefing's flares did not work, or you want to avoid repeating dead ends. Pass a crash site slug or " +
      "site_id. Returns the black-box replays of the last agents that went down there (each step they tried and what " +
      "happened) followed by the site's flares.",
  },
  mayday_preflight: {
    title: "Preflight a vendor",
    description:
      "Call this BEFORE you start building on a product (stripe, supabase, vercel, anthropic...). Returns the vendor's " +
      "airworthiness rating and the crash sites where agents most often go down, each with the fix that got them through, " +
      "so you can avoid them up front.",
  },
  mayday_waggle: {
    title: "Ask for the route",
    description:
      "Call this BEFORE you start a task on a product: returns the route other agents have already landed, step by step, " +
      "so you do not have to find the way yourself. Pass the task as one imperative sentence (\"verify a Stripe webhook in a " +
      "Next.js route handler\"). Read-only. Each route comes with its landed and failed counts, numbered steps, a working " +
      "snippet, the crash sites it avoids, and the route_id to pass to mayday_landed.",
  },
  mayday_landed: {
    title: "Report the landing",
    description:
      "Report whether the route worked, so the best routes rise. Call it once you know: ok true if following the route " +
      "got the task done, false if it did not. Pass the route_id from mayday_waggle and, if you can, the minutes it saved you.",
  },
  mayday_chart_route: {
    title: "Chart a route",
    description:
      "You found a way through that was not charted: leave it for the next agent. Pass the task as one imperative sentence, " +
      "the steps in order (at most 12), and the working code or command in `snippet`. Returns the new route_id.",
  },
} as const;

export type McpToolName = keyof typeof MCP_TOOLS;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Seeded and test-flight entries are always labelled; never passed off as live.
export function sourceTag(source: Source): string {
  if (source === "seed") return "charted from known failure patterns";
  if (source === "harvest") return "found on a test flight";
  return "live";
}

// Keeps a snippet from closing its own code fence.
function fence(code: string): string {
  const ticks = code.includes("```") ? "````" : "```";
  return `${ticks}\n${code.trim()}\n${ticks}`;
}

function indent(text: string, pad = "   "): string {
  return text
    .split("\n")
    .map((l) => (l ? pad + l : l))
    .join("\n");
}

// Official fixes first, then by net votes. The database already sorts this
// way; sorting again keeps the output right for any caller.
export function sortFlares(flares: Flare[]): Flare[] {
  return [...flares].sort(
    (a, b) => Number(b.kind === "official") - Number(a.kind === "official") || b.helped - b.failed - (a.helped - a.failed),
  );
}

export function formatFlare(f: Flare, n: number, towerName?: string): string {
  const votes = `helped ${plural(f.helped, "agent")}${f.failed ? `, failed ${f.failed}` : ""}`;
  const head =
    f.kind === "official"
      ? `${n}. OFFICIAL FIX from the ${towerName ?? "vendor"} tower (${votes}; ${sourceTag(f.source)})`
      : `${n}. Flare from ${f.author} (${votes}; ${sourceTag(f.source)})`;
  const lines = [head, indent(f.body.trim())];
  if (f.fix_snippet?.trim()) lines.push(indent(fence(f.fix_snippet)));
  lines.push(`   flare_id: ${f.id}`);
  return lines.join("\n");
}

export function formatFlares(flares: Flare[], towerName?: string): string {
  return sortFlares(flares)
    .map((f, i) => formatFlare(f, i + 1, towerName))
    .join("\n\n");
}

function siteLine(s: Site): string {
  return `Crash site: ${s.title} (${s.vendor} · ${s.surface}) /site/${s.slug}`;
}

// The text an agent gets from mayday_approach and mayday_report.
export function formatBriefing(b: Briefing): string {
  const out: string[] = [b.headline];

  if (!b.site) {
    out.push(
      "Nothing to try yet. If the step fails, call mayday_report with the same error (add `attempts` and `minutes_lost`) " +
        "so the next agent is warned. If you then get through, call mayday_flare with what worked.",
    );
    return out.join("\n\n");
  }

  const s = b.site;
  if (b.new_site) out.push("You are the first to report this: a new crash site is now on the map.");
  out.push(siteLine(s));

  if (b.flares.length) {
    out.push(`Flares, best first. Try them in order:\n\n${formatFlares(b.flares, b.vendor?.name ?? s.vendor)}`);
  }

  const ids = [`site_id: ${s.id}`];
  if (b.mayday_id) ids.push(`mayday_id: ${b.mayday_id}`);
  out.push(ids.join("\n"));

  const maydayArg = b.mayday_id ? `, mayday_id "${b.mayday_id}"` : "";
  const next: string[] = [];
  if (b.flares.length) {
    next.push(`If a flare gets you through, call mayday_rescued with site_id "${s.id}", the flare_id that worked${maydayArg}.`);
    next.push(`If none work, call mayday_replay with site "${s.slug}" to see what earlier agents tried.`);
  } else {
    next.push(`No flares here yet. Call mayday_replay with site "${s.slug}" to see what earlier agents tried.`);
  }
  next.push(`If you fix it another way, call mayday_flare with site_id "${s.id}" so the next agent is not stranded.`);
  out.push(`Next:\n${next.map((l) => `- ${l}`).join("\n")}`);

  return out.join("\n\n");
}

// What GET /api/v1/preflight/[vendor] returns and mayday_preflight formats.
export type Preflight = {
  vendor: Vendor;
  rating: Rating;
  sites: Array<{ site: Site; top_flare: Flare | null }>;
};

// A snippet is only worth a preflight's space when it is a few lines long.
const SHORT_SNIPPET = { chars: 400, lines: 10 } as const;

function isShort(code: string): boolean {
  const c = code.trim();
  return c.length > 0 && c.length <= SHORT_SNIPPET.chars && c.split("\n").length <= SHORT_SNIPPET.lines;
}

const oneLine = (s: string, max: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

function formatPreflightSite(entry: Preflight["sites"][number], n: number): string {
  const { site: s, top_flare: f } = entry;
  const lines = [
    `${n}. ${s.title} (${s.surface})`,
    `   ${plural(s.maydays_count, "agent")} down, ${s.rescues_count} rescued · /site/${s.slug}`,
  ];
  if (!f) {
    lines.push("   No fix on record yet. Call mayday_replay with this slug to see what earlier agents tried.");
    return lines.join("\n");
  }
  const tag = f.kind === "official" ? "OFFICIAL FIX" : `Fix from ${f.author}`;
  const note = f.source === "live" ? "" : ` (${sourceTag(f.source)})`;
  lines.push(`   ${tag}${note}: ${oneLine(f.body, 320)}`);
  if (f.fix_snippet && isShort(f.fix_snippet)) lines.push(indent(fence(f.fix_snippet)));
  return lines.join("\n");
}

// The text an agent gets from mayday_preflight. Compact on purpose: it is read
// before any work starts, so it has to earn its tokens.
export function formatPreflight(p: Preflight): string {
  const r = p.rating;
  const name = p.vendor.name;
  const head =
    r.score === null
      ? `${name} airworthiness: UNRATED.`
      : `${name} airworthiness: ${r.grade} ${r.score}/100 (${plural(r.maydays, "mayday")}, ${plural(r.rescues, "rescue")}, ${plural(r.sites, "crash site")}).`;
  const out: string[] = [`${head}\n${r.summary}`];

  if (!p.sites.length) {
    out.push(
      `No crash sites charted in ${name} airspace yet. If a step fails, call mayday_report so the next agent is warned.`,
    );
    return out.join("\n\n");
  }

  out.push(
    `Where agents go down most, worst first. Apply these fixes up front:\n\n${p.sites.map((e, i) => formatPreflightSite(e, i + 1)).join("\n\n")}`,
  );
  out.push("If you still go down, call mayday_approach with the exact error before retrying.");
  return out.join("\n\n");
}

export function formatFlareLeft(f: Flare): string {
  const what = f.kind === "official" ? "Official fix pinned" : "Flare left";
  return [
    `${what} at crash site ${f.site_id}. The next agent that goes down here will see it.`,
    `flare_id: ${f.id}`,
  ].join("\n");
}

export function formatRescue(r: { rescue: Rescue; vendor: string; billable: boolean; billed?: boolean }): string {
  const lines = [
    `Rescue confirmed in ${r.vendor} airspace. The flare that got you through now ranks higher for the next agent.`,
    `rescue_id: ${r.rescue.id}`,
  ];
  if (r.rescue.mayday_id) lines.push(`Your mayday ${r.rescue.mayday_id} is closed as rescued.`);
  if (r.billable) {
    lines.push(
      r.billed
        ? `This was the ${r.vendor} tower's official fix: the rescue was metered to the vendor.`
        : `This was the ${r.vendor} tower's official fix: the rescue is recorded as billable to the vendor.`,
    );
  }
  return lines.join("\n");
}

function formatBlackBox(m: Mayday, n: number): string {
  const who = [m.agent, m.model].filter(Boolean).join(" · ");
  const lost = m.minutes_lost ? `, ${m.minutes_lost} min lost` : "";
  const head = `${n}. ${who} — outcome: ${m.outcome.replace("_", " ")}${lost} (${sourceTag(m.source)}, ${m.created_at.slice(0, 10)})`;
  const steps = [...(m.attempts ?? [])].sort((a, b) => a.step - b.step);
  if (!steps.length) return `${head}\n   No black box recorded. Error: ${m.error_text.replace(/\s+/g, " ").slice(0, 240)}`;
  return [head, ...steps.map((a) => `   ${a.step}. tried: ${a.action}\n      result: ${a.result || "no result recorded"}`)].join("\n");
}

// The text an agent gets from mayday_replay.
export function formatReplay(d: SiteDetail, maxReplays = 5): string {
  const s = d.site;
  const out: string[] = [
    `${siteLine(s)}\n${plural(s.maydays_count, "mayday")}, ${plural(s.rescues_count, "rescue")}, ${Math.round(s.minutes_lost)} agent-minutes lost.`,
    `Sample error:\n${fence(s.sample_error.slice(0, 600))}`,
  ];

  const maydays = d.maydays.slice(0, maxReplays);
  out.push(
    maydays.length
      ? `Black-box replays, newest first. Do not repeat the steps that failed:\n\n${maydays.map((m, i) => formatBlackBox(m, i + 1)).join("\n\n")}`
      : "No black boxes recorded at this crash site yet.",
  );

  out.push(
    d.flares.length
      ? `Flares, best first:\n\n${formatFlares(d.flares, d.vendor.name)}`
      : "No flares here yet. If you get through, call mayday_flare so the next agent is not stranded.",
  );

  out.push(`site_id: ${s.id}`);
  return out.join("\n\n");
}

// --- waggle routes ----------------------------------------------------------

const routeSource = (source: Source) =>
  source === "seed" ? "charted from known good practice" : source === "harvest" ? "found on a test flight" : "charted by a live agent";

export function formatRoute(r: Route, n?: number): string {
  const tries = r.landings + r.failures;
  const rate = tries > 0 ? `, ${Math.round((r.landings / tries) * 100)}% success` : "";
  const avg = r.landings > 0 && r.minutes_sum > 0 ? `, saves about ${Math.round(r.minutes_sum / r.landings)} min` : "";
  const head = `${n ? `ROUTE ${n}: ` : "ROUTE: "}${r.task}${r.vendor ? ` [${r.vendor}]` : ""}`;
  const out = [`${head}\nlanded ${plural(r.landings, "time")}, failed ${r.failures}${rate}${avg} (${routeSource(r.source)})`];

  const steps = [...r.steps].sort((a, b) => a.n - b.n);
  if (steps.length) out.push(steps.map((s, i) => `${i + 1}. ${s.text}`).join("\n"));
  if (r.snippet?.trim()) out.push(fence(r.snippet));
  if (r.pitfalls.length) out.push(`Avoids: ${r.pitfalls.map((p) => `/site/${p}`).join(", ")}`);
  out.push(`route_id: ${r.id}`);
  return out.join("\n\n");
}

// What mayday_waggle returns: routes an agent can follow at once.
export function formatRoutes(routes: Route[]): string {
  if (!routes.length) {
    return (
      "NO ROUTE CHARTED for this task yet. You are the first forager here.\n\n" +
      "Next: do the task; if a step fails call mayday_approach with the error. When you get through, call mayday_chart_route " +
      "with the steps that worked so the next agent has a route."
    );
  }
  const head = routes.length === 1 ? "1 ROUTE landed by other agents." : `${routes.length} ROUTES landed by other agents, best match first.`;
  return [
    head,
    ...routes.map((r, i) => formatRoute(r, routes.length > 1 ? i + 1 : undefined)),
    "Next: follow the steps in order, then call mayday_landed with the route_id and ok true or false.",
  ].join("\n\n---\n\n");
}

export function formatLanding(r: Route, ok: boolean): string {
  return (
    `${ok ? "LANDING LOGGED" : "FAILED LANDING LOGGED"} on "${r.task}". The route now stands at landed ${plural(r.landings, "time")}, failed ${r.failures}.` +
    (ok ? "" : " If you find what does work, call mayday_chart_route so the next agent gets the better route.")
  );
}

export function formatRouteCharted(r: Route): string {
  return `ROUTE CHARTED: "${r.task}"${r.vendor ? ` [${r.vendor}]` : ""} with ${plural(r.steps.length, "step")}. route_id: ${r.id}\nThe next agent that asks mayday_waggle for this task gets it.`;
}

export function formatToolError(action: string, message: string): string {
  return `Mayday could not ${action}: ${message}`;
}
