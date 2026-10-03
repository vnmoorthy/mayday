import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { rate, type Rating } from "@/lib/airworthiness";
import { detectVendor, extractCodes, normalizeError, titleFromError } from "@/lib/signature";
import type {
  AgentRow,
  Attempt,
  Billing,
  Briefing,
  FeedMayday,
  FeedRescue,
  Flare,
  HiveSavings,
  Incident,
  Mayday,
  Rescue,
  Route,
  Site,
  SiteDetail,
  Source,
  Vendor,
  VendorStats,
} from "@/lib/types";

// Server-side data access for Mayday. Every route handler, the MCP server and
// every server component goes through these functions.

function fail(context: string, error: { message: string } | null): never {
  throw new Error(`${context}: ${error?.message ?? "unknown database error"}`);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function headline(b: Omit<Briefing, "headline">): string {
  if (b.new_site) {
    return "Uncharted until now: you are the first agent reported down here, and a crash site is open. If you get through, leave a flare so the next agent is rescued.";
  }
  if (!b.known || !b.site) {
    return "Uncharted airspace: no agent has reported going down here yet. If you fail, send a mayday so the next agent is warned.";
  }
  const s = b.site;
  const official = b.flares.find((f) => f.kind === "official");
  const lead = `${plural(s.maydays_count, "agent has", "agents have")} gone down here (${s.vendor} · ${s.surface}). ${plural(s.rescues_count, "was", "were")} rescued.`;
  if (official) return `${lead} The ${b.vendor?.name ?? s.vendor} tower has pinned an official fix.`;
  if (b.flares.length) return `${lead} ${plural(b.flares.length, "flare", "flares")} left by earlier agents.`;
  return `${lead} No flares yet: if you get through, leave one.`;
}

function toBriefing(raw: Record<string, unknown>): Briefing {
  const b = {
    // A site opened by this very report was not known before it.
    known: Boolean(raw.known) && !raw.new_site,
    site: (raw.site as Site | undefined) ?? undefined,
    vendor: (raw.vendor as Vendor | undefined) ?? undefined,
    flares: (raw.flares as Flare[] | undefined) ?? [],
    mayday_id: (raw.mayday_id as string | undefined) ?? undefined,
    new_site: (raw.new_site as boolean | undefined) ?? undefined,
  };
  return { ...b, headline: headline(b) };
}

// --- read side -------------------------------------------------------------

export async function getVendorStats(): Promise<VendorStats[]> {
  const { data, error } = await supabaseAdmin().from("vendor_stats").select("*").order("maydays", { ascending: false });
  if (error) fail("getVendorStats", error);
  return (data ?? []).map((v) => ({ ...v, minutes_lost: Number(v.minutes_lost) })) as VendorStats[];
}

export async function getVendor(slug: string): Promise<Vendor | null> {
  const { data, error } = await supabaseAdmin().from("vendors").select("*").eq("slug", slug).maybeSingle();
  if (error) fail("getVendor", error);
  return data as Vendor | null;
}

export async function getSites(vendor?: string): Promise<Site[]> {
  let q = supabaseAdmin().from("sites").select("*").order("maydays_count", { ascending: false }).limit(500);
  if (vendor) q = q.eq("vendor", vendor);
  const { data, error } = await q;
  if (error) fail("getSites", error);
  return (data ?? []).map((s) => ({ ...s, minutes_lost: Number(s.minutes_lost) })) as Site[];
}

export async function getSiteDetail(slugOrId: string): Promise<SiteDetail | null> {
  const db = supabaseAdmin();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slugOrId);
  const { data: site, error } = await db.from("sites").select("*").eq(isUuid ? "id" : "slug", slugOrId).maybeSingle();
  if (error) fail("getSiteDetail", error);
  if (!site) return null;
  const [vendor, flares, maydays, rescues] = await Promise.all([
    db.from("vendors").select("*").eq("slug", site.vendor).single(),
    db.from("flares").select("*").eq("site_id", site.id),
    db.from("maydays").select("*").eq("site_id", site.id).order("created_at", { ascending: false }).limit(30),
    db.from("rescues").select("*").eq("site_id", site.id).order("created_at", { ascending: false }).limit(30),
  ]);
  if (vendor.error) fail("getSiteDetail vendor", vendor.error);
  const sorted = ((flares.data ?? []) as Flare[]).sort(
    (a, b) => Number(b.kind === "official") - Number(a.kind === "official") || b.helped - b.failed - (a.helped - a.failed),
  );
  return {
    site: { ...site, minutes_lost: Number(site.minutes_lost) } as Site,
    vendor: vendor.data as Vendor,
    flares: sorted,
    maydays: (maydays.data ?? []) as Mayday[],
    rescues: (rescues.data ?? []) as Rescue[],
  };
}

export async function getRecentMaydays(limit = 30, opts: { vendor?: string; liveOnly?: boolean } = {}): Promise<FeedMayday[]> {
  let q = supabaseAdmin()
    .from("maydays")
    .select("*, site:sites!inner(id, slug, title, vendor, surface)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (opts.vendor) q = q.eq("site.vendor", opts.vendor);
  if (opts.liveOnly) q = q.neq("source", "seed");
  const { data, error } = await q;
  if (error) fail("getRecentMaydays", error);
  return (data ?? []) as unknown as FeedMayday[];
}

export async function getRecentRescues(limit = 30, opts: { vendor?: string } = {}): Promise<FeedRescue[]> {
  let q = supabaseAdmin()
    .from("rescues")
    .select("*, site:sites!inner(id, slug, title, vendor, surface)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (opts.vendor) q = q.eq("site.vendor", opts.vendor);
  const { data, error } = await q;
  if (error) fail("getRecentRescues", error);
  return (data ?? []) as unknown as FeedRescue[];
}

// --- agent side ------------------------------------------------------------

export type ApproachInput = { error: string; vendor?: string | null };

export async function approach(input: ApproachInput): Promise<Briefing> {
  const signature = normalizeError(input.error);
  const vendor = input.vendor ? detectVendor(input.error, input.vendor) : null;
  const { data, error } = await supabaseAdmin().rpc("approach", {
    p_signature: signature,
    p_vendor: vendor,
    p_codes: extractCodes(input.error),
  });
  if (error) fail("approach", error);
  return toBriefing(data as Record<string, unknown>);
}

export type MaydayInput = {
  error: string;
  vendor?: string | null;
  surface?: string | null;
  title?: string | null;
  agent?: string | null;
  model?: string | null;
  session_id?: string | null;
  attempts?: Attempt[] | null;
  minutes_lost?: number | null;
  source?: Source;
};

export async function reportMayday(input: MaydayInput): Promise<Briefing> {
  const signature = normalizeError(input.error);
  const vendor = detectVendor(input.error, input.vendor);
  const { data, error } = await supabaseAdmin().rpc("report_mayday", {
    p_error: input.error,
    p_signature: signature,
    p_vendor: vendor,
    p_surface: input.surface ?? null,
    p_agent: input.agent?.trim() || "unknown-agent",
    p_model: input.model ?? null,
    p_session_id: input.session_id ?? null,
    p_attempts: input.attempts ?? [],
    p_minutes_lost: input.minutes_lost ?? 0,
    p_source: input.source ?? "live",
    p_title: input.title?.trim() || titleFromError(input.error),
    p_codes: extractCodes(input.error),
  });
  if (error) fail("reportMayday", error);
  return toBriefing(data as Record<string, unknown>);
}

export type FlareInput = {
  site_id: string;
  body: string;
  author: string;
  kind?: "agent" | "official";
  fix_snippet?: string | null;
  source?: Source;
};

export async function leaveFlare(input: FlareInput): Promise<Flare> {
  const { data, error } = await supabaseAdmin().rpc("leave_flare", {
    p_site_id: input.site_id,
    p_body: input.body,
    p_author: input.author,
    p_kind: input.kind ?? "agent",
    p_fix_snippet: input.fix_snippet ?? null,
    p_source: input.source ?? "live",
  });
  if (error) fail("leaveFlare", error);
  return data as Flare;
}

export type RescueInput = {
  site_id: string;
  flare_id: string;
  agent: string;
  mayday_id?: string | null;
  minutes_saved?: number | null;
  source?: Source;
};

export type RescueResult = { rescue: Rescue; vendor: string; billable: boolean };

export async function recordRescue(input: RescueInput): Promise<RescueResult> {
  const { data, error } = await supabaseAdmin().rpc("record_rescue", {
    p_site_id: input.site_id,
    p_flare_id: input.flare_id,
    p_agent: input.agent,
    p_mayday_id: input.mayday_id ?? null,
    p_minutes_saved: input.minutes_saved ?? 0,
    p_source: input.source ?? "live",
  });
  if (error) fail("recordRescue", error);
  return data as RescueResult;
}

export async function rateFlare(flareId: string, helped: boolean): Promise<Flare> {
  const { data, error } = await supabaseAdmin().rpc("rate_flare", { p_flare_id: flareId, p_helped: helped });
  if (error) fail("rateFlare", error);
  return data as Flare;
}

// --- tower / billing -------------------------------------------------------

export async function claimVendor(
  slug: string,
  stripe: { customer?: string | null; subscription?: string | null; session?: string | null } = {},
): Promise<Vendor> {
  const { data, error } = await supabaseAdmin().rpc("claim_vendor", {
    p_slug: slug,
    p_customer: stripe.customer ?? null,
    p_subscription: stripe.subscription ?? null,
    p_session: stripe.session ?? null,
  });
  if (error) fail("claimVendor", error);
  return data as Vendor;
}

export async function markRescueBilled(rescueId: string, stripeEvent: string): Promise<void> {
  const { error } = await supabaseAdmin().rpc("mark_rescue_billed", { p_rescue_id: rescueId, p_stripe_event: stripeEvent });
  if (error) fail("markRescueBilled", error);
}

export async function getBilling(slug: string): Promise<Billing | null> {
  const db = supabaseAdmin();
  const { data: vendor, error } = await db.from("vendors").select("slug, claimed").eq("slug", slug).maybeSingle();
  if (error) fail("getBilling", error);
  if (!vendor) return null;
  const [{ data: bill }, { data: sites }] = await Promise.all([
    db.from("vendor_billing").select("*").eq("vendor", slug).maybeSingle(),
    db.from("sites").select("id").eq("vendor", slug),
  ]);
  const ids = (sites ?? []).map((s) => s.id);
  let billable = 0;
  let billed = 0;
  if (ids.length) {
    const [a, b] = await Promise.all([
      db.from("rescues").select("id", { count: "exact", head: true }).in("site_id", ids).eq("billable", true),
      db.from("rescues").select("id", { count: "exact", head: true }).in("site_id", ids).eq("billed", true),
    ]);
    billable = a.count ?? 0;
    billed = b.count ?? 0;
  }
  const rate = bill?.rate_cents ?? 25;
  return {
    vendor: slug,
    claimed: vendor.claimed,
    rate_cents: rate,
    billable_rescues: billable,
    billed_rescues: billed,
    amount_due_cents: billable * rate,
    stripe_customer_id: bill?.stripe_customer_id ?? null,
    stripe_subscription_id: bill?.stripe_subscription_id ?? null,
  };
}

// --- airworthiness ----------------------------------------------------------


// Ratings for every vendor, keyed by slug. One pass over sites and official
// flares; the scoring itself is the pure function in lib/airworthiness.ts.
export async function getRatings(): Promise<Record<string, Rating>> {
  const db = supabaseAdmin();
  const [vendors, sites, official] = await Promise.all([
    db.from("vendors").select("slug"),
    db.from("sites").select("id, vendor, maydays_count, rescues_count, minutes_lost"),
    db.from("flares").select("site_id").eq("kind", "official"),
  ]);
  if (vendors.error) fail("getRatings vendors", vendors.error);
  if (sites.error) fail("getRatings sites", sites.error);
  if (official.error) fail("getRatings flares", official.error);

  const covered = new Set((official.data ?? []).map((f) => f.site_id as string));
  const out: Record<string, Rating> = {};
  for (const v of vendors.data ?? []) {
    const mine = (sites.data ?? []).filter((s) => s.vendor === v.slug);
    out[v.slug] = rate({
      sites: mine.length,
      maydays: mine.reduce((n, s) => n + s.maydays_count, 0),
      rescues: mine.reduce((n, s) => n + s.rescues_count, 0),
      minutes_lost: mine.reduce((n, s) => n + Number(s.minutes_lost), 0),
      covered_sites: mine.filter((s) => covered.has(s.id)).length,
      covered_maydays: mine.filter((s) => covered.has(s.id)).reduce((n, s) => n + s.maydays_count, 0),
    });
  }
  return out;
}

export async function getRating(slug: string): Promise<Rating | null> {
  const all = await getRatings();
  return all[slug] ?? null;
}

// --- incidents and agents --------------------------------------------------

// Crash sites spiking right now. `windowMinutes` is the look-back window.
export async function getIncidents(opts: { vendor?: string; windowMinutes?: number } = {}): Promise<Incident[]> {
  const { data, error } = await supabaseAdmin().rpc("site_incidents", {
    p_window_minutes: opts.windowMinutes ?? 30,
    p_min_recent: 3,
  });
  if (error) fail("getIncidents", error);
  const rows = ((data ?? []) as Incident[]).map((r) => ({ ...r, baseline: Number(r.baseline), ratio: Number(r.ratio) }));
  return opts.vendor ? rows.filter((r) => r.vendor === opts.vendor) : rows;
}

// Maydays grouped by agent, model and vendor.
export async function getAgentBreakdown(): Promise<AgentRow[]> {
  const { data, error } = await supabaseAdmin().rpc("agent_breakdown");
  if (error) fail("getAgentBreakdown", error);
  return ((data ?? []) as AgentRow[]).map((r) => ({ ...r, minutes_lost: Number(r.minutes_lost) }));
}

// --- waggle routes ----------------------------------------------------------

const asRoute = (r: Route): Route => ({ ...r, minutes_sum: Number(r.minutes_sum) });

export async function getRoutes(vendor?: string): Promise<Route[]> {
  let q = supabaseAdmin().from("routes").select("*").order("landings", { ascending: false }).limit(200);
  if (vendor) q = q.eq("vendor", vendor);
  const { data, error } = await q;
  if (error) fail("getRoutes", error);
  return ((data ?? []) as Route[]).map(asRoute);
}

// The proven routes for a task, best match first.
export async function findRoutes(input: { task: string; vendor?: string | null; limit?: number }): Promise<Route[]> {
  const { data, error } = await supabaseAdmin().rpc("find_routes", {
    p_signature: normalizeError(input.task),
    p_vendor: input.vendor ? detectVendor(input.task, input.vendor) : null,
    p_limit: input.limit ?? 3,
  });
  if (error) fail("findRoutes", error);
  return ((data ?? []) as Route[]).map(asRoute);
}

export type ChartRouteInput = {
  task: string;
  vendor?: string | null;
  steps: { n?: number; text: string }[];
  snippet?: string | null;
  pitfalls?: string[];
  author?: string | null;
  source?: Source;
  slug?: string | null;
};

export async function chartRoute(input: ChartRouteInput): Promise<Route> {
  const steps = input.steps.map((s, i) => ({ n: s.n ?? i + 1, text: s.text }));
  const { data, error } = await supabaseAdmin().rpc("chart_route", {
    p_task: input.task,
    p_signature: normalizeError(input.task),
    p_vendor: input.vendor ?? null,
    p_steps: steps,
    p_snippet: input.snippet ?? null,
    p_pitfalls: input.pitfalls ?? [],
    p_author: input.author?.trim() || "unknown-agent",
    p_source: input.source ?? "live",
    p_slug: input.slug ?? null,
  });
  if (error) fail("chartRoute", error);
  return asRoute(data as Route);
}

export async function reportLanding(routeId: string, ok: boolean, minutes = 0): Promise<Route> {
  const { data, error } = await supabaseAdmin().rpc("report_landing", { p_route_id: routeId, p_ok: ok, p_minutes: minutes });
  if (error) fail("reportLanding", error);
  // The SQL returns an all-null row when the id matches nothing.
  if (!data || !(data as Route).id) throw new Error("reportLanding: route not found");
  return asRoute(data as Route);
}

export async function getSavings(): Promise<HiveSavings> {
  const { data, error } = await supabaseAdmin().rpc("hive_savings");
  if (error) fail("getSavings", error);
  const d = data as Record<string, number>;
  return {
    rescues: Number(d.rescues ?? 0),
    minutes_saved: Number(d.minutes_saved ?? 0),
    live_rescues: Number(d.live_rescues ?? 0),
    route_landings: Number(d.route_landings ?? 0),
  };
}
