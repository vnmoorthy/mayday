import "server-only";
import { getRecentMaydays, getRecentRescues, getRoutes, getSiteDetail, getSites } from "@/lib/data";
import type { FeedSignal, FeedRescue, Flare, Route, Site } from "@/lib/types";
import type { Replay, ReplayEntry } from "./replay-types";

// The flight replay: two real agents flying flights/hivepay-payout, a scenario
// on a fictional vendor whose requirements no model was trained on. Everything
// here is read from the rows they left behind: stop signals, flares, the route and
// rescues. No row, no entry.

export const HIVEPAY = "hivepay";
export const PIONEER = "claude-pioneer";
export const FOLLOWER = "claude-follower";

// "down" is every stop signal's starting state and says nothing "Check run failed"
// does not, so only the outcomes that add information get a tag.
const OUTCOME: Record<string, string> = { rescued: "rescued", self_recovered: "self-recovered" };

const time = (iso: string | null | undefined) => {
  const t = iso ? new Date(iso).getTime() : Number.NaN;
  return Number.isNaN(t) ? null : t;
};

const clock = (iso: string | null | undefined) => {
  const t = time(iso);
  return t === null ? null : `${new Date(t).toISOString().slice(11, 19)} UTC`;
};

const clip = (s: unknown, max: number) => {
  const text = typeof s === "string" ? s.trim() : s == null ? "" : String(s);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

// The one line of an error a person would read first: the line carrying an
// error code, else the line naming an Error, else the first line.
export function keyLine(errorText: string): string {
  const lines = String(errorText ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const hit =
    lines.find((l) => /\[[A-Z][A-Z0-9_]{2,}\]/.test(l)) ??
    lines.find((l) => /\b[A-Z]\w*Error\b/.test(l)) ??
    lines.find((l) => /error|fail|refused|rejected/i.test(l)) ??
    lines[0] ??
    "";
  return clip(hit, 240);
}

type Timed = { t: number; order: number; entry: ReplayEntry };

const chronological = (items: Timed[]) => items.sort((a, b) => a.t - b.t || a.order - b.order).map((i) => i.entry);

function maydayEntry(m: FeedSignal): Timed {
  const attempts = Array.isArray(m.attempts)
    ? m.attempts.slice(0, 8).map((a, i) => ({
        step: Number(a?.step ?? i + 1) || i + 1,
        action: clip(a?.action, 220),
        result: clip(a?.result, 220),
      }))
    : [];
  return {
    t: time(m.created_at) ?? Number.MAX_SAFE_INTEGER,
    order: 0,
    entry: {
      id: `mayday-${m.id}`,
      kind: "mayday",
      clock: clock(m.created_at),
      head: "Check run failed",
      tag: OUTCOME[m.outcome] ?? undefined,
      error: keyLine(m.error_text),
      site: m.site ? { slug: m.site.slug, title: m.site.title } : undefined,
      attempts: attempts.length ? attempts : undefined,
    },
  };
}

function routeSteps(route: Route) {
  if (!Array.isArray(route.steps)) return [];
  return route.steps
    .map((s, i) => ({ n: Number(s?.n ?? i + 1) || i + 1, text: clip(typeof s === "string" ? s : s?.text, 400) }))
    .filter((s) => s.text);
}

const EMPTY: Replay = {
  error: null,
  hasData: false,
  incomplete: true,
  pioneer: [],
  follower: [],
  pioneerFails: 0,
  pioneerLanded: false,
  followerFails: 0,
  followerFlown: false,
  sitesCharted: 0,
  routeCharted: false,
};

// The defaults are the HivePay flights. The arguments exist so the same
// loader can be pointed at another vendor and pair of agents.
export async function loadReplay(vendor: string = HIVEPAY, pioneerAgent: string = PIONEER, followerAgent: string = FOLLOWER): Promise<Replay> {
  let sites: Site[] = [];
  let maydays: FeedSignal[] = [];
  let routes: Route[] = [];
  let rescues: FeedRescue[] = [];
  try {
    [sites, maydays, routes, rescues] = await Promise.all([
      getSites(vendor),
      getRecentMaydays(200, { vendor }),
      getRoutes(vendor),
      getRecentRescues(100, { vendor }),
    ]);
  } catch (err) {
    return { ...EMPTY, error: err instanceof Error ? err.message : "Unknown error" };
  }

  // Flares live on the crash sites. A site whose detail cannot be read is
  // skipped: the timeline simply shows fewer flares.
  const flares: Flare[] = [];
  const siteById = new Map(sites.map((s) => [s.id, s]));
  const details = await Promise.allSettled(sites.map((s) => getSiteDetail(s.slug)));
  for (const d of details) {
    if (d.status === "fulfilled" && d.value) flares.push(...d.value.flares);
  }
  const flareById = new Map(flares.map((f) => [f.id, f]));

  const pioneerMaydays = maydays.filter((m) => m.agent === pioneerAgent);
  const followerMaydays = maydays.filter((m) => m.agent === followerAgent);
  const followerRescues = rescues.filter((r) => r.agent === followerAgent);
  const pioneerFlares = flares.filter((f) => f.author === pioneerAgent);
  const route = routes.find((r) => r.author === pioneerAgent) ?? routes[0] ?? null;
  const steps = route ? routeSteps(route) : [];

  // --- pioneer: stop signals, flares and the route, in the order they were recorded.
  const pioneer: Timed[] = pioneerMaydays.map(maydayEntry);
  for (const f of pioneerFlares) {
    const site = siteById.get(f.site_id);
    pioneer.push({
      t: time(f.created_at) ?? Number.MAX_SAFE_INTEGER,
      order: 1,
      entry: {
        id: `flare-${f.id}`,
        kind: "flare",
        clock: clock(f.created_at),
        head: "Left a flare",
        body: clip(f.body, 600),
        snippet: f.fix_snippet ? clip(f.fix_snippet, 600) : null,
        site: site ? { slug: site.slug, title: site.title } : undefined,
      },
    });
  }
  if (route) {
    pioneer.push({
      t: time(route.created_at) ?? Number.MAX_SAFE_INTEGER,
      order: 2,
      entry: {
        id: `route-${route.id}`,
        kind: "route",
        clock: clock(route.created_at),
        head: "Charted the route",
        task: clip(route.task, 300),
        steps,
      },
    });
  }

  // --- follower: the route it was handed, then whatever it reported.
  const followerFlown =
    followerMaydays.length > 0 || followerRescues.length > 0 || Boolean(route && route.landings + route.failures > 0);
  const middle: Timed[] = followerMaydays.map(maydayEntry);
  for (const r of followerRescues) {
    const flare = flareById.get(r.flare_id);
    middle.push({
      t: time(r.created_at) ?? Number.MAX_SAFE_INTEGER,
      order: 1,
      entry: {
        id: `rescue-${r.id}`,
        kind: "rescue",
        clock: clock(r.created_at),
        head: "Rescued by a flare",
        body: flare ? clip(flare.body, 600) : undefined,
        snippet: flare?.fix_snippet ? clip(flare.fix_snippet, 600) : null,
        site: r.site ? { slug: r.site.slug, title: r.site.title } : undefined,
        note: flare ? `Flare left by ${flare.author}` : undefined,
      },
    });
  }
  const follower: ReplayEntry[] = [];
  if (route && followerFlown) {
    follower.push({
      id: `ask-${route.id}`,
      kind: "ask",
      // The lookup itself is a read and leaves no row, so it has no timestamp.
      clock: null,
      head: "Asked the hive for the route",
      task: clip(route.task, 300),
      steps,
      note: `GET /api/v1/waggle · route charted by ${route.author}`,
    });
  }
  follower.push(...chronological(middle));
  if (route && route.landings > 0) {
    follower.push({
      id: `landed-${route.id}`,
      kind: "landed",
      clock: clock(route.last_landed),
      head: "Landed",
      note: `Recorded on the route: ${route.landings} ${route.landings === 1 ? "landing" : "landings"}, ${route.failures} ${
        route.failures === 1 ? "failure" : "failures"
      }.`,
    });
  }

  return {
    error: null,
    hasData: sites.length > 0 || maydays.length > 0 || routes.length > 0,
    incomplete: !(route && route.landings > 0),
    pioneer: chronological(pioneer),
    follower,
    pioneerFails: pioneerMaydays.length,
    pioneerLanded: Boolean(route),
    followerFails: followerMaydays.length,
    followerFlown,
    sitesCharted: sites.length,
    routeCharted: Boolean(route),
  };
}
