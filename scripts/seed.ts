// Charts the known airspace: loads scripts/seed-data.ts into Supabase and
// generates the seeded stop signals and rescues around each crash site.
//
//   node --env-file=.env.local scripts/seed.ts             add whatever is missing
//   node --env-file=.env.local scripts/seed.ts --reset     remove seeded rows, then reseed
//   node scripts/seed.ts --dry-run                         print the plan, touch nothing
//
// Row ids are derived from the site slug, so a second run inserts nothing new
// and never overwrites a row that live traffic has since changed. Everything
// written here carries source = 'seed'.

import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SeedSite } from "./seed-data.ts";

// Node needs the ".ts" extension to load these two; tsc, as this project is
// configured, rejects it on a static value import. Loading them by URL keeps
// both happy, and the types still come from the modules themselves.
const load = <T>(file: string) => import(new URL(file, import.meta.url).href) as Promise<T>;
const { normalizeError } = await load<typeof import("../lib/signature")>("../lib/signature.ts");
const { sites: seedSites, vendors: seedVendors } = await load<typeof import("./seed-data")>("./seed-data.ts");

const BATCH = 500;
const MAX_MAYDAYS = 2500;
const MIN = 60_000;
const DAY = 86_400_000;

type Weighted = [value: string, weight: number][];

const AGENTS: Weighted = [
  ["claude-code", 42],
  ["cursor", 22],
  ["codex", 14],
  ["eve", 9],
  ["windsurf", 7],
  ["devin", 6],
];
const CLAUDE_MODELS: Weighted = [
  ["claude-sonnet-5-5", 60],
  ["claude-opus-5-5", 27],
  ["claude-haiku-4-5", 13],
];
const ANY_MODELS: Weighted = [...CLAUDE_MODELS, ["gpt-5.1-codex", 35]];

type FlareRow = {
  id: string;
  site_id: string;
  kind: "agent";
  author: string;
  body: string;
  fix_snippet: string | null;
  helped: number;
  failed: number;
  source: "seed";
  created_at: string;
};

type MaydayRow = {
  id: string;
  site_id: string;
  agent: string;
  model: string;
  session_id: string;
  error_text: string;
  attempts: SeedSite["replay"];
  minutes_lost: number;
  outcome: "down" | "rescued" | "self_recovered";
  source: "seed";
  created_at: string;
};

type RescueRow = {
  id: string;
  site_id: string;
  flare_id: string;
  mayday_id: string;
  agent: string;
  minutes_saved: number;
  billable: false;
  billed: false;
  source: "seed";
  created_at: string;
};

type SitePlan = { site: SeedSite; flares: FlareRow[]; maydays: MaydayRow[]; rescues: RescueRow[] };

// --- deterministic helpers --------------------------------------------------

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Stable uuid for a seeded row, so reruns address the same rows.
function seedUuid(...parts: string[]): string {
  const h = createHash("sha256").update(["mayday-seed", ...parts].join(":")).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function pick(rand: () => number, options: Weighted): string {
  const total = options.reduce((n, [, w]) => n + w, 0);
  let roll = rand() * total;
  for (const [value, w] of options) {
    roll -= w;
    if (roll < 0) return value;
  }
  return options[options.length - 1][0];
}

function modelFor(agent: string, rand: () => number): string {
  if (agent === "codex") return "gpt-5.1-codex";
  if (agent === "claude-code" || agent === "eve") return pick(rand, CLAUDE_MODELS);
  return pick(rand, ANY_MODELS);
}

const iso = (ms: number) => new Date(ms).toISOString();

// --- the plan ---------------------------------------------------------------

function planSite(site: SeedSite, siteId: string, now: number): SitePlan {
  const rand = mulberry32(hashSeed(site.slug));
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

  // Ages of the stop signals. The first sighting is about two weeks back; roughly
  // four in ten land in the last 48 hours, thicker towards now.
  const ages: number[] = [];
  for (let i = 0; i < site.weight; i++) {
    if (i === 0) ages.push((13 + rand() * 0.9) * DAY);
    else if (rand() < 0.4) ages.push(20 * MIN + rand() ** 1.4 * (2 * DAY - 20 * MIN));
    else ages.push(2 * DAY + rand() * 11 * DAY);
  }
  ages.sort((a, b) => b - a);
  const times = ages.map((age) => Math.round(now - age));

  const firstSeen = times[0];
  const topFlareId = seedUuid("flare", site.slug, "0");
  const topFlareAt = firstSeen + int(20, 120) * MIN;

  const maydays: MaydayRow[] = times.map((at, i) => {
    const agent = pick(rand, AGENTS);
    const full = site.replay.length;
    // Some agents give up before trying everything in the template.
    const depth = rand() < 0.55 ? full : int(2, full - 1);
    return {
      id: seedUuid("mayday", site.slug, String(i)),
      site_id: siteId,
      agent,
      model: modelFor(agent, rand),
      session_id: `seed-${hashSeed(`${site.slug}:${i}`).toString(16).padStart(8, "0")}`,
      error_text: site.sample_error,
      attempts: site.replay.slice(0, depth),
      minutes_lost: 2 + Math.floor(rand() ** 1.6 * 34),
      outcome: "down",
      source: "seed",
      created_at: iso(at),
    };
  });

  // Rescues: 35-70% of stop signals, only ones sent after the top flare existed.
  const eligible = times.map((_, i) => i).filter((i) => times[i] > topFlareAt);
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
  }
  const rate = 0.35 + rand() * 0.35;
  const want = Math.min(eligible.length, Math.max(1, Math.round(site.weight * rate)));
  const rescued = eligible.slice(0, want).sort((a, b) => a - b);

  const rescues: RescueRow[] = rescued.map((i) => {
    maydays[i].outcome = "rescued";
    return {
      id: seedUuid("rescue", site.slug, String(i)),
      site_id: siteId,
      flare_id: topFlareId,
      mayday_id: maydays[i].id,
      agent: maydays[i].agent,
      minutes_saved: int(3, 25),
      billable: false,
      billed: false,
      source: "seed",
      created_at: iso(times[i] + int(2, 15) * MIN),
    };
  });
  for (const m of maydays) {
    if (m.outcome === "down" && rand() < 0.12) m.outcome = "self_recovered";
  }

  // The top flare's helped count is exactly its rescues. The other flares
  // only carry a few ratings, which is what /api/v1/rate records.
  const helped = rescues.length;
  const flares: FlareRow[] = site.flares.map((f, j) => ({
    id: j === 0 ? topFlareId : seedUuid("flare", site.slug, String(j)),
    site_id: siteId,
    kind: f.kind,
    author: f.author,
    body: f.body,
    fix_snippet: f.fix_snippet ?? null,
    helped: j === 0 ? helped : Math.floor(helped * (0.04 + rand() * 0.1)),
    failed: j === 0 ? Math.floor((site.weight - helped) * (0.05 + rand() * 0.2)) : int(0, 2),
    source: "seed",
    created_at: iso(j === 0 ? topFlareAt : firstSeen + Math.round((0.5 + j + rand() * 3) * DAY)),
  }));

  return { site, flares, maydays, rescues };
}

function validate(): void {
  const vendorSlugs = new Set(seedVendors.map((v) => v.slug));
  const slugs = new Set<string>();
  const signatures = new Map<string, string>();
  let total = 0;
  for (const s of seedSites) {
    const problem = (why: string): never => {
      throw new Error(`seed-data: ${s.slug}: ${why}`);
    };
    if (slugs.has(s.slug)) problem("duplicate slug");
    slugs.add(s.slug);
    if (!vendorSlugs.has(s.vendor)) problem(`unknown vendor ${s.vendor}`);
    if (!Number.isInteger(s.weight) || s.weight < 3 || s.weight > 120) problem("weight must be 3..120");
    if (s.flares.length < 2 || s.flares.length > 3) problem("needs 2-3 flares");
    if (s.replay.length < 3 || s.replay.length > 5) problem("replay needs 3-5 attempts");
    const signature = normalizeError(s.sample_error);
    const twin = signatures.get(signature);
    if (twin) problem(`same signature as ${twin}`);
    signatures.set(signature, s.slug);
    total += s.weight;
  }
  if (total >= MAX_MAYDAYS) throw new Error(`seed-data: ${total} stop signals, keep it under ${MAX_MAYDAYS}`);
}

// --- database ---------------------------------------------------------------

type Where = { eq?: [column: string, value: string]; in?: [column: string, values: string[]] };

// Reads every matching row, whatever page size the API allows.
async function fetchAll<T>(db: SupabaseClient, table: string, columns: string, where: Where = {}): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    let q = db.from(table).select(columns);
    if (where.eq) q = q.eq(where.eq[0], where.eq[1]);
    if (where.in) q = q.in(where.in[0], where.in[1]);
    const { data, error } = await q.order("id").range(rows.length, rows.length + 999);
    if (error) throw new Error(`read ${table}: ${error.message}`);
    if (!data || data.length === 0) return rows;
    rows.push(...(data as unknown as T[]));
  }
}

async function deleteByIds(db: SupabaseClient, table: string, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await db.from(table).delete().in("id", ids.slice(i, i + 100));
    if (error) throw new Error(`delete ${table}: ${error.message}`);
  }
}

// Inserts rows that are not there yet and returns how many were new.
async function insertMissing(db: SupabaseClient, table: string, rows: { id: string }[]): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { data, error } = await db
      .from(table)
      .upsert(rows.slice(i, i + BATCH), { onConflict: "id", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(`insert ${table}: ${error.message}`);
    inserted += data?.length ?? 0;
  }
  return inserted;
}

async function reset(db: SupabaseClient): Promise<void> {
  for (const table of ["rescues", "maydays"]) {
    const { error } = await db.from(table).delete().eq("source", "seed");
    if (error) throw new Error(`reset ${table}: ${error.message}`);
  }

  // A seeded flare that a live rescue points at stays where it is: deleting
  // it would cascade to that rescue. It has a stable id, so the reseed finds it.
  const live = await fetchAll<{ flare_id: string }>(db, "rescues", "flare_id");
  const pinned = new Set(live.map((r) => r.flare_id));
  const seeded = await fetchAll<{ id: string }>(db, "flares", "id", { eq: ["source", "seed"] });
  await deleteByIds(db, "flares", seeded.map((f) => f.id).filter((id) => !pinned.has(id)));

  // A site with nothing left pointing at it was charted by the seed alone.
  const used = new Set<string>();
  for (const table of ["maydays", "flares", "rescues"]) {
    for (const row of await fetchAll<{ site_id: string }>(db, table, "site_id")) used.add(row.site_id);
  }
  const all = await fetchAll<{ id: string }>(db, "sites", "id");
  await deleteByIds(db, "sites", all.map((s) => s.id).filter((id) => !used.has(id)));
}

type Totals = { maydays: number; rescues: number; minutes: number; first: string | null; last: string | null };

// Sets each site's counters from the rows that are really in the database
// (seeded and live together), so the map can never disagree with its tables.
async function recount(db: SupabaseClient, siteIds: string[]): Promise<Map<string, Totals>> {
  const totals = new Map<string, Totals>(
    siteIds.map((id) => [id, { maydays: 0, rescues: 0, minutes: 0, first: null, last: null }]),
  );
  const maydays = await fetchAll<{ site_id: string; minutes_lost: number | string; created_at: string }>(
    db,
    "maydays",
    "site_id, minutes_lost, created_at",
    { in: ["site_id", siteIds] },
  );
  for (const m of maydays) {
    const t = totals.get(m.site_id);
    if (!t) continue;
    t.maydays += 1;
    t.minutes += Number(m.minutes_lost);
    if (!t.first || Date.parse(m.created_at) < Date.parse(t.first)) t.first = m.created_at;
    if (!t.last || Date.parse(m.created_at) > Date.parse(t.last)) t.last = m.created_at;
  }
  const rescues = await fetchAll<{ site_id: string }>(db, "rescues", "site_id", { in: ["site_id", siteIds] });
  for (const r of rescues) {
    const t = totals.get(r.site_id);
    if (t) t.rescues += 1;
  }

  const entries = [...totals.entries()];
  for (let i = 0; i < entries.length; i += 10) {
    await Promise.all(
      entries.slice(i, i + 10).map(async ([id, t]) => {
        const patch: Record<string, unknown> = {
          maydays_count: t.maydays,
          rescues_count: t.rescues,
          minutes_lost: t.minutes,
        };
        if (t.first && t.last) {
          patch.first_seen = t.first;
          patch.last_seen = t.last;
        }
        const { error } = await db.from("sites").update(patch).eq("id", id);
        if (error) throw new Error(`update site ${id}: ${error.message}`);
      }),
    );
  }
  return totals;
}

// --- output -----------------------------------------------------------------

function printTable(rows: { vendor: string; sites: number; maydays: number; rescues: number; minutes: number }[]): void {
  const line = (cells: (string | number)[]) =>
    `  ${String(cells[0]).padEnd(12)}${cells.slice(1).map((c) => String(c).padStart(10)).join("")}`;
  console.log(line(["airspace", "sites", "signals", "rescues", "min lost"]));
  for (const r of rows) console.log(line([r.vendor, r.sites, r.maydays, r.rescues, r.minutes]));
  const sum = (key: "sites" | "maydays" | "rescues" | "minutes") => rows.reduce((n, r) => n + r[key], 0);
  console.log(line(["total", sum("sites"), sum("maydays"), sum("rescues"), sum("minutes")]));
}

function byVendor(totalsFor: (site: SeedSite) => { maydays: number; rescues: number; minutes: number }) {
  return seedVendors.map((v) => {
    const mine = seedSites.filter((s) => s.vendor === v.slug).map(totalsFor);
    return {
      vendor: v.slug,
      sites: mine.length,
      maydays: mine.reduce((n, t) => n + t.maydays, 0),
      rescues: mine.reduce((n, t) => n + t.rescues, 0),
      minutes: Math.round(mine.reduce((n, t) => n + t.minutes, 0)),
    };
  });
}

// --- main -------------------------------------------------------------------

async function main(): Promise<void> {
  const flags = new Set(process.argv.slice(2));
  const unknown = [...flags].filter((f) => f !== "--reset" && f !== "--dry-run");
  if (unknown.length) throw new Error(`unknown flag ${unknown.join(", ")} (use --reset or --dry-run)`);

  validate();
  const now = Date.now();

  if (flags.has("--dry-run")) {
    const plans = new Map(seedSites.map((s) => [s.slug, planSite(s, seedUuid("site", s.slug), now)]));
    console.log("Dry run: this is what would be charted. Nothing was written.\n");
    printTable(
      byVendor((s) => {
        const p = plans.get(s.slug)!;
        return {
          maydays: p.maydays.length,
          rescues: p.rescues.length,
          minutes: p.maydays.reduce((n, m) => n + m.minutes_lost, 0),
        };
      }),
    );
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. Run: node --env-file=.env.local scripts/seed.ts",
    );
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  if (flags.has("--reset")) {
    console.log("Reset: removing seeded rows...");
    await reset(db);
  }

  // Vendors: only identity columns, so a claimed airspace stays claimed.
  const vendorsResult = await db.from("vendors").upsert(seedVendors, { onConflict: "slug" });
  if (vendorsResult.error) throw new Error(`vendors: ${vendorsResult.error.message}`);

  // Sites: text and signature are refreshed, counters are set by recount().
  const sitesResult = await db
    .from("sites")
    .upsert(
      seedSites.map((s) => ({
        vendor: s.vendor,
        slug: s.slug,
        title: s.title,
        surface: s.surface,
        kind: s.kind,
        signature: normalizeError(s.sample_error),
        sample_error: s.sample_error,
      })),
      { onConflict: "slug" },
    )
    .select("id, slug");
  if (sitesResult.error) throw new Error(`sites: ${sitesResult.error.message}`);
  const idBySlug = new Map((sitesResult.data ?? []).map((r) => [r.slug as string, r.id as string]));

  const plans = seedSites.map((s) => {
    const id = idBySlug.get(s.slug);
    if (!id) throw new Error(`sites: no id returned for ${s.slug}`);
    return planSite(s, id, now);
  });

  // Order matters: rescues reference both flares and stop signals.
  const flares = await insertMissing(db, "flares", plans.flatMap((p) => p.flares));
  const maydays = await insertMissing(db, "maydays", plans.flatMap((p) => p.maydays));
  const rescues = await insertMissing(db, "rescues", plans.flatMap((p) => p.rescues));

  const totals = await recount(db, [...idBySlug.values()]);

  console.log(`Charted ${seedVendors.length} airspaces and ${seedSites.length} crash sites (source = seed).`);
  console.log(`New rows this run: ${flares} flares, ${maydays} stop signals, ${rescues} rescues.`);
  if (flares + maydays + rescues === 0) console.log("Everything was already in place. Use --reset to reseed from scratch.");
  console.log("\nCounters now on the map (seeded and live rows together):\n");
  printTable(
    byVendor((s) => {
      const t = totals.get(idBySlug.get(s.slug)!)!;
      return { maydays: t.maydays, rescues: t.rescues, minutes: t.minutes };
    }),
  );
}

main().catch((err: unknown) => {
  console.error(`seed failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
