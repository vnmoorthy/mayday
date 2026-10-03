"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { layoutComb } from "@/components/radar/comb";
import type { Pulse, PulseKind, Snapshot } from "@/components/radar/geometry";
import { Hive } from "@/components/radar/hive";
import { Bee } from "@/components/ui";
import type { Rating } from "@/lib/airworthiness";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { mergeIncident, onIncident } from "@/components/tower/incident-feed";
import type { Incident, StopSignal, Rescue, Site, VendorStats } from "@/lib/types";
import { BEE_NAME, JOIN_URL, JOIN_URL_SHORT } from "./presets";

// The join address split where it reads naturally, for the two-line display.
const JOIN_SPLIT = JOIN_URL_SHORT.indexOf(".");
const JOIN_HOST_HEAD = JOIN_SPLIT > 0 ? JOIN_URL_SHORT.slice(0, JOIN_SPLIT) : JOIN_URL_SHORT;
const JOIN_HOST_TAIL = JOIN_SPLIT > 0 ? JOIN_URL_SHORT.slice(JOIN_SPLIT) : "";

// Audience mode, projector side. The left two thirds are the live hive map
// (the same component the home page uses); the right third counts what the
// room has done since this page was opened, lists the last ten events, raises
// the spike banner, and shows the code that turns a phone into a bee.
//
// The home page's radar keeps its realtime wiring private, so this is the
// small wrapper around the map API and Supabase Realtime that the stage needs.

type Status = "connecting" | "live" | "polling";

type StageEvent = { id: string; kind: PulseKind; bee: string; title: string; at: string };

// What an inserted row needs to carry for the stage to announce it.
type Row = { id: string; site_id: string; agent: string; created_at: string };

const FEED_SIZE = 10;
const REFETCH_DEBOUNCE_MS = 800;
// Incidents arrive by Realtime broadcast; this refresh is only a fallback.
const INCIDENT_POLL_MS = 60_000;
// With Realtime up the map is still re-read now and then, in case the socket went quiet.
const LIVE_POLL_MS = 15_000;
const OFFLINE_POLL_MS = 4000;
const PULSE_MS = 2800;
// The hive is laid out at a fixed size per vendor cluster and then scaled to the
// space it is given, so its captions grow with the projector.
const CLUSTER_WIDTH = 260;
// The hive's own padding, and the height of one vendor caption, in layout pixels.
const HIVE_PAD_X = 32;
const HIVE_PAD_Y = 36;
const CAPTION_HEIGHT = 36;

const SWATCH = {
  red: "radial-gradient(circle at 36% 30%, #ff7a7a, #c8102e 55%, #6d0718)",
  honey: "radial-gradient(circle at 36% 30%, #ffd76a, #e79a12 55%, #8a4b00)",
  cap: "linear-gradient(135deg, #fff6c2, #f1dc8a)",
} as const;

const noop = () => {};

// Only audience names are printed on the projector. Anything else that reaches
// the public API (a real agent, or someone with curl) is shown as "an agent".
const beeOf = (agent: unknown) => (typeof agent === "string" && BEE_NAME.test(agent) ? agent : "an agent");

function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour12: false });
}

// How many columns of clusters fill a box best: the count that lets every
// cluster be drawn largest. On a projector that is one or two rows.
function bestColumns(count: number, aspect: number, aw: number, ah: number): number {
  let best = 1;
  let bestScale = 0;
  for (let cols = 1; cols <= Math.max(1, count); cols++) {
    const rows = Math.ceil(Math.max(1, count) / cols);
    const w = cols * CLUSTER_WIDTH + HIVE_PAD_X;
    const h = rows * (CLUSTER_WIDTH * aspect + CAPTION_HEIGHT) + HIVE_PAD_Y;
    const scale = Math.min(aw / w, ah / h);
    if (scale > bestScale + 1e-6) {
      best = cols;
      bestScale = scale;
    }
  }
  return best;
}

// Lays the hive out in the number of columns that fills the box best, then
// scales it to fit. `aspect` is one cluster's height over its width.
function FitHive({ count, aspect, children }: { count: number; aspect: number; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ s: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const measure = () => {
      const aw = o.clientWidth;
      const ah = o.clientHeight;
      if (!aw || !ah) return;
      const cols = bestColumns(count, aspect, aw, ah);
      const width = cols * CLUSTER_WIDTH + HIVE_PAD_X;
      // Set the layout first, so the height read next belongs to it. React
      // leaves these two alone: it only manages opacity and transform here.
      i.style.width = `${width}px`;
      i.style.setProperty("--stage-cols", String(cols));
      const h = i.offsetHeight;
      if (!h) return;
      const s = Math.min(aw / width, ah / h);
      setBox({ s, x: (aw - width * s) / 2, y: (ah - h * s) / 2 });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, [count, aspect]);

  return (
    <div ref={outer} className="relative min-h-0 flex-1 overflow-hidden">
      <div
        ref={inner}
        // The hive picks its own columns from its width; the stage overrides that with the count chosen above.
        className="pointer-events-none absolute left-0 top-0 origin-top-left transition-opacity duration-300 [&_.grid]:grid-cols-[repeat(var(--stage-cols,2),minmax(0,1fr))]!"
        style={{
          opacity: box ? 1 : 0,
          transform: box ? `translate(${box.x}px, ${box.y}px) scale(${box.s})` : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Counter({ label, value, tone }: { label: string; value: string; tone: "distress" | "ink" }) {
  return (
    <div className="flex min-w-0 flex-col gap-[0.6vh]">
      <span className="label text-[clamp(0.7rem,1.3vh,0.95rem)]!">{label}</span>
      <span
        className={clsx(
          "tabular text-[clamp(3rem,10.5vh,7.5rem)] font-extrabold leading-[0.9] tracking-[-0.05em]",
          tone === "distress" ? "text-distress" : "text-ink",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function Stage() {
  const [vendors, setVendors] = useState<VendorStats[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [ratings, setRatings] = useState<Record<string, Rating>>({});
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<Status>("connecting");
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [events, setEvents] = useState<StageEvent[]>([]);
  // Counted from the moment the page opened, not from the database.
  const [down, setDown] = useState(0);
  const [rescued, setRescued] = useState(0);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [incidentWindow, setIncidentWindow] = useState(30);
  // The same set as trustedRef, for render.
  const [trusted, setTrusted] = useState<ReadonlySet<string>>(() => new Set());

  const sitesRef = useRef(new Map<string, Site>());
  // Crash sites that were on the map when the stage opened. Only their titles
  // are printed: a site created mid-demo takes its title from whatever error
  // text was sent, and that should not reach a projector unread.
  const trustedRef = useRef(new Set<string>());
  const seenRef = useRef(new Set<string>());
  const primedRef = useRef(false);
  const fetchingRef = useRef(false);
  const pulseSeq = useRef(0);
  const pulseTimers = useRef<number[]>([]);
  const refetchTimer = useRef<number | null>(null);
  const incidentTimer = useRef<number | null>(null);

  useEffect(() => {
    const timers = pulseTimers.current;
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      if (refetchTimer.current !== null) window.clearTimeout(refetchTimer.current);
      if (incidentTimer.current !== null) window.clearTimeout(incidentTimer.current);
    };
  }, []);

  // --- incidents ---------------------------------------------------------------

  const loadIncidents = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/incidents", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { incidents?: Incident[]; window_minutes?: number };
      setIncidents(Array.isArray(body?.incidents) ? body.incidents : []);
      if (typeof body?.window_minutes === "number" && Number.isFinite(body.window_minutes)) setIncidentWindow(body.window_minutes);
    } catch {
      // Keep whatever is showing; the next poll asks again.
    }
  }, []);

  // The database broadcasts a spike the moment it detects one: show it at once.
  useEffect(() => onIncident((incident) => setIncidents((prev) => mergeIncident(prev, incident))), []);

  useEffect(() => {
    const first = window.setTimeout(() => void loadIncidents(), 0);
    const id = window.setInterval(() => void loadIncidents(), INCIDENT_POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [loadIncidents]);

  // --- live events -------------------------------------------------------------

  const pulse = useCallback((siteId: string, kind: PulseKind) => {
    const key = `${kind}-${siteId}-${pulseSeq.current++}`;
    setPulses((p) => [...p.slice(-11), { key, siteId, kind }]);
    pulseTimers.current.push(window.setTimeout(() => setPulses((p) => p.filter((x) => x.key !== key)), PULSE_MS));
  }, []);

  // Every stop signal and rescue since the page opened passes through here exactly once.
  const announce = useCallback(
    (kind: PulseKind, row: Row) => {
      if (!row?.id || seenRef.current.has(row.id)) return;
      seenRef.current.add(row.id);
      const site = sitesRef.current.get(row.site_id);
      const title = site && trustedRef.current.has(site.id) ? site.title : "a new crash site";
      const event: StageEvent = { id: row.id, kind, bee: beeOf(row.agent), title, at: row.created_at };
      setEvents((prev) => [event, ...prev].slice(0, FEED_SIZE));
      if (kind === "mayday") {
        setDown((n) => n + 1);
      } else {
        setRescued((n) => n + 1);
      }
      pulse(row.site_id, kind);
    },
    [pulse],
  );

  const applySnapshot = useCallback(
    (snap: Snapshot) => {
      const nextSites = snap.sites.map((s) => ({ ...s, minutes_lost: Number(s.minutes_lost) }));
      sitesRef.current = new Map(nextSites.map((s) => [s.id, s]));
      setVendors(snap.vendors);
      setSites(nextSites);
      if (snap.ratings && typeof snap.ratings === "object") setRatings(snap.ratings);

      const maydays = Array.isArray(snap.maydays) ? snap.maydays : [];
      const rescues = Array.isArray(snap.rescues) ? snap.rescues : [];

      // The first snapshot is history: it sets the baseline and counts nothing.
      if (!primedRef.current) {
        primedRef.current = true;
        nextSites.forEach((s) => trustedRef.current.add(s.id));
        setTrusted(new Set(trustedRef.current));
        [...maydays, ...rescues].forEach((e) => seenRef.current.add(e.id));
        setLoaded(true);
        return;
      }

      // Anything unseen arrived while Realtime was not looking. Oldest first,
      // so the newest ends up on top of the feed.
      const fresh = [
        ...maydays.map((row) => ({ kind: "mayday" as const, row })),
        ...rescues.map((row) => ({ kind: "rescue" as const, row })),
      ]
        .filter((e) => !seenRef.current.has(e.row.id))
        .sort((a, b) => a.row.created_at.localeCompare(b.row.created_at));
      fresh.forEach((e) => announce(e.kind, e.row));
    },
    [announce],
  );

  const refetch = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const res = await fetch("/api/v1/map", { cache: "no-store" });
      if (!res.ok) return;
      const snap = (await res.json()) as Snapshot;
      if (Array.isArray(snap?.sites) && Array.isArray(snap?.vendors)) applySnapshot(snap);
    } catch {
      // Keep the last good picture; the next event or poll tries again.
    } finally {
      fetchingRef.current = false;
    }
  }, [applySnapshot]);

  // Debounced, so a room full of taps costs one map request.
  const refetchSoon = useCallback(
    (delay = REFETCH_DEBOUNCE_MS) => {
      if (refetchTimer.current !== null) window.clearTimeout(refetchTimer.current);
      refetchTimer.current = window.setTimeout(() => {
        refetchTimer.current = null;
        void refetch();
      }, delay);
    },
    [refetch],
  );

  // First picture.
  useEffect(() => {
    const t = window.setTimeout(() => void refetch(), 0);
    return () => window.clearTimeout(t);
  }, [refetch]);

  useEffect(() => {
    const sb = supabaseBrowser();
    if (!sb) {
      const t = window.setTimeout(() => setStatus("polling"), 0);
      return () => window.clearTimeout(t);
    }
    let cancelled = false;

    const onInsert = (kind: PulseKind, row: Row) => {
      // Before the first snapshot there is no baseline to count against, and a
      // crash site that is not on the map yet has no cell to fire. In both
      // cases the next snapshot announces the row instead.
      if (primedRef.current && sitesRef.current.has(row.site_id)) announce(kind, row);
      refetchSoon();
    };

    const channel = sb
      .channel(`stage-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "maydays" }, (p) => onInsert("mayday", p.new as StopSignal))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "rescues" }, (p) => onInsert("rescue", p.new as Rescue))
      .subscribe((s) => {
        if (cancelled) return;
        if (s === "SUBSCRIBED") {
          setStatus("live");
          refetchSoon(0);
        } else {
          setStatus("polling");
        }
      });

    return () => {
      cancelled = true;
      void sb.removeChannel(channel);
    };
  }, [announce, refetchSoon]);

  useEffect(() => {
    if (status === "connecting") return;
    const id = window.setInterval(() => void refetch(), status === "live" ? LIVE_POLL_MS : OFFLINE_POLL_MS);
    return () => window.clearInterval(id);
  }, [status, refetch]);

  // "f" toggles fullscreen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "f" || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      e.preventDefault();
      if (document.fullscreenElement) void document.exitFullscreen().catch(noop);
      else void document.documentElement.requestFullscreen().catch(noop);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // --- derived -----------------------------------------------------------------

  // Alphabetical, so clusters never move as counts change (same as the home page).
  // An airspace with no crash sites would be an empty comb on the projector, so it is left out.
  const vendorRows = useMemo(() => {
    const charted = new Set(sites.map((s) => s.vendor));
    const shown = vendors.filter((v) => charted.has(v.slug));
    // Two airspaces can share a display name. The room has to be able to tell
    // them apart, so every airspace after the first is captioned with its slug.
    const named = new Set<string>();
    return [...shown]
      .sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug))
      .map((v) => {
        const key = v.name.toLowerCase();
        if (!named.has(key)) {
          named.add(key);
          return v;
        }
        return { ...v, name: v.slug };
      });
  }, [vendors, sites]);
  const comb = useMemo(() => layoutComb(sites, vendorRows), [sites, vendorRows]);
  const fixes = useMemo(
    () => Object.fromEntries(Object.entries(ratings).map(([slug, r]) => [slug, r?.covered_sites ?? 0])),
    [ratings],
  );
  const totals = useMemo(
    () => sites.reduce((t, s) => ({ maydays: t.maydays + s.maydays_count, rescues: t.rescues + s.rescues_count }), { maydays: 0, rescues: 0 }),
    [sites],
  );

  // All three counters read zero until the room does something.
  const rate = `${down > 0 ? Math.min(100, Math.round((rescued / down) * 100)) : 0}%`;
  const spike = useMemo(() => [...incidents].sort((a, b) => b.recent - a.recent)[0] ?? null, [incidents]);
  const spikeTitle = spike ? (trusted.has(spike.site_id) ? spike.title : "a new crash site") : "";

  return (
    <div className="flex h-full w-full flex-col gap-[1.4vh] p-[1.6vw]">
      {/* A spike takes the full width of the room, in red. It is held to two
          lines, so it never squeezes the join code off the bottom of the screen. */}
      {spike ? (
        <div
          className="flex shrink-0 items-center gap-[1.4vw] rounded-2xl border-2 border-distress bg-distress px-[1.6vw] py-[1.3vh] text-comb shadow-[0_0_0_0.5vh_rgba(184,15,38,0.25)]"
          role="alert"
          aria-live="assertive"
        >
          <span className="h-[3vh] w-[3vh] shrink-0 animate-flicker rounded-full bg-comb" aria-hidden />
          <p className="line-clamp-2 min-w-0 text-[clamp(1.25rem,3.9vh,3.25rem)] font-extrabold leading-[1.06] tracking-[-0.03em]">
            <span className="animate-flicker">SPIKE:</span> {spike.recent} agents down in the last {incidentWindow} min at{" "}
            {spikeTitle}
          </p>
          <span className="ml-auto shrink-0 text-right font-mono text-[clamp(0.7rem,1.5vh,1.05rem)] uppercase leading-snug tracking-[0.14em] text-comb/85">
            {incidents.length > 1 ? (
              <span className="block font-bold text-comb">
                +{incidents.length - 1} more {incidents.length === 2 ? "site" : "sites"}
              </span>
            ) : null}
            <span className="hidden lg:block">
              detected by a
              <br />
              database trigger
            </span>
          </span>
        </div>
      ) : null}

      <div className="grid min-h-0 w-full flex-1 grid-cols-[minmax(0,2fr)_minmax(22rem,1fr)] gap-[1.6vw]">
      {/* Left two thirds: the hive, live. */}
      <section className="flex min-h-0 min-w-0 flex-col gap-[1.4vh]">
        <header className="flex items-end justify-between gap-6">
          <div className="flex items-center gap-[0.8vw]">
            <Bee className="h-[4.4vh] w-[5.2vh] text-ink" />
            <h1 className="text-[clamp(1.75rem,5vh,3.75rem)] font-extrabold! leading-none text-ink">PIONEER</h1>
            <span className="hidden pl-[0.6vw] text-[clamp(0.9rem,2vh,1.4rem)] font-semibold leading-none text-mute lg:inline">
              the stop signal for agents
            </span>
          </div>
          <div className="flex items-center gap-[1.2vw] font-mono text-[clamp(0.65rem,1.3vh,0.9rem)] uppercase tracking-[0.14em] text-mute">
            <span className="hidden items-center gap-2 xl:flex">
              <span className="h-3 w-3 rounded-full" style={{ background: SWATCH.red }} aria-hidden />
              down
            </span>
            <span className="hidden items-center gap-2 xl:flex">
              <span className="h-3 w-3 rounded-full" style={{ background: SWATCH.honey }} aria-hidden />
              fixes working
            </span>
            <span className="hidden items-center gap-2 xl:flex">
              <span className="h-3 w-3 rounded-full ring-1 ring-ink/30" style={{ background: SWATCH.cap }} aria-hidden />
              rescued
            </span>
            <span className="flex items-center gap-2 text-ink">
              <span
                className={clsx("h-2.5 w-2.5 rounded-full", status === "live" ? "animate-flicker bg-distress" : "bg-ink/40")}
                aria-hidden
              />
              {status === "live" ? "Live" : status === "polling" ? "Polling" : "Connecting"}
            </span>
          </div>
        </header>

        {loaded ? (
          <FitHive count={comb.clusters.length} aspect={comb.height / comb.width}>
            <Hive
              comb={comb}
              pulses={pulses}
              fixes={fixes}
              activeVendor={null}
              openSiteId={null}
              onToggleVendor={noop}
              onOpenSite={noop}
            />
          </FitHive>
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center rounded-3xl border border-ink/15 bg-panel">
            <span className="label animate-flicker text-[clamp(0.8rem,1.6vh,1.1rem)]!">Reading the hive…</span>
          </div>
        )}

        <footer className="flex flex-col gap-[0.5vh]">
          <div className="tabular flex items-center justify-between gap-6 font-mono text-[clamp(0.65rem,1.3vh,0.9rem)] uppercase tracking-[0.14em] text-mute">
            <span className="min-w-0 truncate">
              All time: {totals.maydays.toLocaleString("en-US")} stop signals · {totals.rescues.toLocaleString("en-US")} rescues ·{" "}
              {sites.length} crash sites · counts mostly charted
            </span>
            <span className="shrink-0 whitespace-nowrap">f: fullscreen</span>
          </div>
          <p className="truncate text-[clamp(0.75rem,1.6vh,1.05rem)] font-semibold leading-tight text-ink">
            Every tap is a real write to Postgres. Spikes are detected by a database trigger.
          </p>
        </footer>
      </section>

      {/* Right third: what this room has done since the page opened. */}
      <aside className="flex min-h-0 min-w-0 flex-col gap-[1.6vh]">
        {spike ? null : (
          <div className="rounded-2xl border border-ink/15 bg-panel px-[1.1vw] py-[1.3vh] text-mute" role="status" aria-live="polite">
            <p className="text-[clamp(0.85rem,1.9vh,1.25rem)] font-semibold leading-tight">
              No spike. Every crash site is at its own baseline.
            </p>
          </div>
        )}

        <div className="shrink-0 rounded-2xl border border-ink/15 bg-panel px-[1.1vw] py-[1.6vh]">
          <div className="flex items-end justify-between gap-[1vw]">
            <Counter label="Bees down" value={String(down)} tone="distress" />
            <Counter label="Rescued" value={String(rescued)} tone="ink" />
            <Counter label="Rescue rate" value={rate} tone="ink" />
          </div>
          <p className="label mt-[1vh] text-[clamp(0.6rem,1.15vh,0.8rem)]!">Since this screen opened</p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-ink/15 bg-panel px-[1.1vw] py-[1.3vh]">
          <span className="label text-[clamp(0.7rem,1.3vh,0.95rem)]!">Live feed</span>
          {events.length ? (
            <ol className="mt-[0.8vh] flex min-h-0 flex-1 flex-col gap-[0.5vh] overflow-hidden" aria-live="off">
              {events.map((e) => (
                <li
                  key={e.id}
                  className="flex animate-rise items-baseline gap-[0.6vw] text-[clamp(0.85rem,2vh,1.3rem)] leading-tight text-ink"
                >
                  <span
                    className={clsx(
                      "h-[1.1vh] w-[1.1vh] shrink-0 self-center rounded-full",
                      e.kind === "mayday" ? "bg-distress" : "border border-ink/50 bg-comb",
                    )}
                    aria-hidden
                  />
                  <span className={clsx("shrink-0 font-mono font-semibold", e.kind === "mayday" ? "text-distress" : "text-ink")}>
                    {e.bee}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-mute">
                    {e.kind === "mayday" ? "went down at" : "was rescued at"} <span className="text-ink">{e.title}</span>
                  </span>
                  <span className="tabular hidden shrink-0 font-mono text-[0.7em] text-dim 2xl:inline">{clock(e.at)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-[1vh] text-[clamp(0.95rem,2.2vh,1.4rem)] font-semibold leading-snug text-mute">
              Waiting for the first bee. Scan the code and fly.
            </p>
          )}
        </div>

        <div className="shrink-0 rounded-2xl border border-ink bg-panel px-[1.1vw] py-[1.5vh]">
          <div className="flex items-center gap-[1.2vw]">
            <img
              src="/qr-join.svg"
              alt={`QR code for ${JOIN_URL}`}
              width={410}
              height={410}
              className="h-[clamp(9rem,27vh,20rem)] w-auto shrink-0 rounded-xl border-2 border-ink bg-white"
            />
            <p className="text-[clamp(1.5rem,4.6vh,3.5rem)] font-extrabold leading-[0.95] tracking-[-0.04em] text-ink">
              Scan.
              <br />
              Become a bee.
            </p>
          </div>
          {/* Two lines, so the address is twice the size one line would allow. */}
          <p
            className="mt-[1.2vh] font-mono text-[clamp(1.15rem,2.4vw,3.4rem)] font-extrabold leading-[1.05] tracking-[-0.03em] text-ink"
            aria-label={JOIN_URL_SHORT}
          >
            <span className="block whitespace-nowrap">{JOIN_HOST_HEAD}</span>
            <span className="block whitespace-nowrap">{JOIN_HOST_TAIL}</span>
          </p>
        </div>
      </aside>
      </div>
    </div>
  );
}
