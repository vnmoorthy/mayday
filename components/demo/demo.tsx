"use client";

import clsx from "clsx";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Bee, Button, ButtonLink } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { Flare, Flight, FlightEvent, FlightMode, Route, Site } from "@/lib/types";

// The product demo: one button runs the whole loop against the live API.
// Reset the demo airspace, fly the pioneer (Agent 1), then fly the follower
// (Agent 2). Every number on this page is read from those two flights and
// from what Postgres holds for the airspace; nothing is hard-coded.

const AIRSPACE = "hivepay-live";

type Phase = "idle" | "reset" | "pioneer" | "gap" | "follower" | "done";
type Run = { events: FlightEvent[]; running: boolean; flight: Flight | null; error: string | null };
type HiveSite = Site & { flares: Flare[] };
type Hive = { sites: HiveSite[]; routes: Route[] };

const IDLE: Run = { events: [], running: false, flight: null, error: null };
const EMPTY: Hive = { sites: [], routes: [] };

const CARD = "rounded-2xl border border-ink/15 bg-panel";
// The page's red and burnt honey are tuned for the yellow field; inside the
// dark well they are too dark to read, so the well has its own pale pair.
const WELL_RED = "text-[#ff9a8f]";
const WELL_HONEY = "text-[#ffd27a]";

const STEPS = ["Empty hive", "Agent 1 fails and reports", "The hive is notified", "Agent 2 is warned and lands"];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const isRefused = (e: FlightEvent) => e.kind === "result" && e.name === "create_payout" && e.ok === false;
// Hive tools are named "<product>_<verb>" (report, flare, chart_route, waggle,
// landed, rescued). Only the verb matters on this page, so it is read from the
// name whatever the prefix is.
const HIVE_VERBS = ["report", "flare", "chart_route", "waggle", "landed", "rescued"];
function hiveVerb(name?: string): string | null {
  if (!name) return null;
  const cut = name.indexOf("_");
  const verb = cut < 0 ? "" : name.slice(cut + 1);
  return HIVE_VERBS.includes(verb) ? verb : null;
}
const isHive = (e: FlightEvent) => hiveVerb(e.name) !== null;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

function short(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

// Briefings and routes open with a long "untrusted content" preamble that is
// meant for the model. On screen the line starts at what the hive said.
function hiveSaid(s: string): string {
  const body = s.startsWith("UNTRUSTED CONTENT") ? s.slice(s.indexOf("\n\n") + 2) : s;
  return short(body, 230);
}

// A tool call arrives as `name {json}`. Shown as one short line.
function callText(e: FlightEvent): string {
  const name = e.name ?? e.text.split(" ")[0];
  const raw = e.text.slice(name.length).trim();
  if (!raw) return name;
  let args: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
  } catch {
    args = null; // a long call is clipped by the server and no longer parses
  }
  if (!args) return `${name} ${short(raw.replace(/\\"/g, '"'), 170)}`;
  const s = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));
  const verb = hiveVerb(name);
  let shown: string;
  if (name === "create_payout") shown = `${s(args.params_json) || "{}"} ${s(args.options_json) || "{}"}`;
  else if (verb === "report") shown = s(args.error);
  else if (verb === "flare") shown = s(args.body);
  else if (verb === "waggle") shown = s(args.task);
  else if (verb === "chart_route") shown = `${s(args.task)} · ${plural(Array.isArray(args.steps) ? args.steps.length : 0, "step", "steps")}`;
  else if (verb === "landed") shown = `ok: ${s(args.ok)}`;
  else shown = JSON.stringify(args);
  return `${name} ${short(shown, 170)}`;
}

function Line({ e, highlight }: { e: FlightEvent; highlight?: boolean }) {
  if (e.kind === "start") return <div className="text-comb/60">take-off · {e.text}</div>;
  if (e.kind === "think") return <div className="italic text-comb/70">{short(e.text, 200)}</div>;
  if (e.kind === "error") return <div className={WELL_RED}>error: {e.text}</div>;
  if (e.kind === "done") {
    return <div className={clsx("mt-2 border-t border-comb/25 pt-2 font-bold", e.ok ? "text-comb" : WELL_RED)}>{e.text}</div>;
  }
  if (e.kind === "tool") {
    return (
      <div className={clsx("mt-2", isHive(e) ? WELL_HONEY : "text-comb", highlight && "-mx-2 rounded-md bg-[#ffd27a]/20 px-2 py-1 font-bold ring-1 ring-[#ffd27a]/70")}>
        $ {callText(e)}
      </div>
    );
  }
  if (e.name === "create_payout") {
    return e.ok ? (
      <div className="font-bold text-comb">paid: {e.text}</div>
    ) : (
      <div className={WELL_RED}>
        <span className="font-bold">refused:</span> {short(e.text, 220)}
      </div>
    );
  }
  if (isHive(e)) return <div className={e.ok === false ? WELL_RED : clsx(WELL_HONEY, "opacity-85")}>{hiveSaid(e.text)}</div>;
  return <div className={e.ok === false ? WELL_RED : "text-comb/60"}>{short(e.text, 200)}</div>;
}

function Terminal({ run, waiting, highlightIndex }: { run: Run; waiting: string; highlightIndex?: number }) {
  const well = useRef<HTMLDivElement>(null);
  // The newest line stays in view.
  useEffect(() => {
    const el = well.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [run.events.length, run.running, run.error]);
  return (
    <div
      ref={well}
      className="terminal scroll-thin h-72 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-3 font-mono text-[12.5px] leading-[1.5] [overflow-wrap:anywhere] lg:h-auto lg:flex-1"
    >
      {run.events.length === 0 && !run.error ? <div className="text-comb/50">{run.running ? "Taking off…" : waiting}</div> : null}
      {run.events.map((e, i) => (
        <Line key={i} e={e} highlight={i === highlightIndex} />
      ))}
      {run.error ? <div className={WELL_RED}>error: {run.error}</div> : null}
      {run.running ? <div className="mt-1 animate-flicker text-comb/70">▍</div> : null}
    </div>
  );
}

function refusedOf(run: Run): number {
  return run.flight ? run.flight.failed_attempts : run.events.filter(isRefused).length;
}

function statusOf(run: Run): string {
  if (run.running) return "In the air…";
  if (run.error) return "Flight failed";
  const done = run.events.find((e) => e.kind === "done");
  const landed = run.flight ? run.flight.landed : done?.ok;
  if (run.flight || done) return landed ? "Landed" : "Did not land";
  return "Waiting";
}

function AgentColumn({ title, run, waiting, highlightIndex, callouts }: { title: string; run: Run; waiting: string; highlightIndex?: number; callouts?: ReactNode }) {
  const refused = refusedOf(run);
  return (
    <section className={clsx(CARD, "flex min-h-0 min-w-0 flex-col gap-3 p-4")}>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-extrabold! tracking-tight text-ink">{title}</h2>
          <span className="label">{statusOf(run)}</span>
        </div>
        <div className="flex shrink-0 items-end gap-2.5">
          <span className="label pb-1.5 text-right leading-tight">
            Refused
            <br />
            calls
          </span>
          <span className="tabular text-6xl font-extrabold leading-[0.85] tracking-[-0.05em] text-distress xl:text-7xl">{refused}</span>
        </div>
      </div>
      {callouts}
      <Terminal run={run} waiting={waiting} highlightIndex={highlightIndex} />
    </section>
  );
}

function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="flex animate-rise items-center gap-2 rounded-full border border-flare/60 bg-flare/10 px-3 py-1.5 text-sm font-bold text-flare">
      <Bee className="h-4 w-5 shrink-0" />
      {children}
    </div>
  );
}

function SiteCard({ site }: { site: HiveSite }) {
  return (
    <li className="relative rounded-2xl border border-distress/50 bg-comb/70 p-3">
      {/* Re-keyed on the count, so the pulse plays when the card appears and each time another agent goes down here. */}
      <span key={site.maydays_count} aria-hidden="true" className="demo-pulse pointer-events-none absolute inset-0 rounded-2xl" />
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 text-sm font-bold leading-snug text-ink [overflow-wrap:anywhere]">{site.title}</span>
        <span className="tabular shrink-0 rounded-full border border-distress/60 bg-distress/10 px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-distress">
          Reported {site.maydays_count}×
        </span>
      </div>
      {site.flares.map((f) => (
        <p key={f.id} className="mt-2 animate-rise text-[13px] font-semibold leading-snug text-flare [overflow-wrap:anywhere]">
          Fix left by {f.author === "gemini-pioneer" ? "Agent 1" : f.author}: <span className="font-medium">{short(f.body, 190)}</span>
        </p>
      ))}
    </li>
  );
}

function HiveColumn({ hive, emptied }: { hive: Hive; emptied: boolean }) {
  const list = useRef<HTMLDivElement>(null);
  const flares = hive.sites.reduce((n, s) => n + s.flares.length, 0);
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [hive.sites.length, flares, hive.routes.length]);
  const route = hive.routes[0];
  const nothing = hive.sites.length === 0 && !route;
  return (
    <section className={clsx(CARD, "flex min-h-0 min-w-0 flex-col gap-3 p-4")}>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-extrabold! tracking-tight text-ink">
            <Bee className="h-5 w-6" /> The hive
          </h2>
          <span className="block text-xs font-medium text-mute">Stored in Postgres. Any agent can ask.</span>
        </div>
        <div className="flex shrink-0 items-end gap-2.5">
          <span className="label pb-1.5 text-right leading-tight">
            Crash sites
            <br />
            known
          </span>
          <span className="tabular text-6xl font-extrabold leading-[0.85] tracking-[-0.05em] text-ink xl:text-7xl">{hive.sites.length}</span>
        </div>
      </div>
      <div ref={list} className="scroll-thin min-h-40 overflow-y-auto overflow-x-hidden p-1 lg:min-h-0 lg:flex-1">
        {nothing ? (
          <div className="flex h-full min-h-36 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-ink/40 px-5 text-center">
            <span className="text-base font-bold text-ink">Nothing known. No agent has been here.</span>
            <span className="text-sm text-mute">{emptied ? "The demo airspace was just emptied." : "Crash sites appear here the moment an agent reports one."}</span>
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {hive.sites.map((s) => (
              <SiteCard key={s.id} site={s} />
            ))}
            {route ? (
              <li className="animate-rise rounded-2xl border border-flare/60 bg-flare/10 p-3">
                <div className="text-sm font-extrabold text-flare">Route charted: {plural(route.steps.length, "step", "steps")}</div>
                <p className="mt-1 text-[13px] leading-snug text-ink/80 [overflow-wrap:anywhere]">{short(route.task, 160)}</p>
              </li>
            ) : null}
          </ul>
        )}
      </div>
    </section>
  );
}

function StepIndicator({ step, complete }: { step: number; complete: boolean }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const active = !complete && step === n;
        const past = complete || step > n;
        return (
          <li
            key={label}
            aria-current={active ? "step" : undefined}
            className={clsx(
              "flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-[13px] font-semibold transition-colors",
              active ? "border-ink bg-ink text-bg" : past ? "border-ink/60 text-ink" : "border-ink/25 text-ink/55",
            )}
          >
            <span className={clsx("tabular flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold", active ? "bg-bg text-ink" : past ? "bg-ink text-bg" : "bg-ink/15 text-ink/70")}>{n}</span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}

function Big({ children, tone }: { children: ReactNode; tone: string }) {
  return <span className={clsx("tabular mx-1.5 inline-block align-baseline text-5xl font-extrabold leading-none tracking-[-0.05em] xl:text-6xl", tone)}>{children}</span>;
}

export function Demo() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [pioneer, setPioneer] = useState<Run>(IDLE);
  const [follower, setFollower] = useState<Run>(IDLE);
  const [hive, setHive] = useState<Hive>(EMPTY);
  const [problem, setProblem] = useState<string | null>(null);
  const [warnedAbout, setWarnedAbout] = useState<number | null>(null);
  const busy = useRef(false);
  const hiveRef = useRef<Hive>(EMPTY);
  const fetchSeq = useRef(0);
  const applied = useRef(0);
  const [emptied, setEmptied] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // What Pioneer holds for the demo airspace right now.
  const refreshHive = useCallback(async () => {
    const seq = ++fetchSeq.current;
    try {
      const r = await fetch("/api/v1/demo/state", { cache: "no-store" });
      if (!r.ok) return;
      const d = (await r.json()) as { sites?: HiveSite[]; routes?: Route[] };
      if (seq < applied.current) return; // an older answer must not overwrite a newer one
      applied.current = seq;
      const next: Hive = { sites: d.sites ?? [], routes: d.routes ?? [] };
      hiveRef.current = next;
      setHive(next);
    } catch {
      // keep what is on screen; the next poll tries again
    }
  }, []);

  // Flies one agent in the demo airspace and streams it into its column.
  const fly = useCallback(
    async (mode: FlightMode, set: (fn: (r: Run) => Run) => void): Promise<Flight | null> => {
      set(() => ({ ...IDLE, running: true }));
      let flight: Flight | null = null;
      let error: string | null = null;
      try {
        const res = await fetch("/api/v1/flight", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, airspace: AIRSPACE }),
        });
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error || `The flight could not start (${res.status}).`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const handle = (line: string) => {
          if (!line.trim()) return;
          let item: FlightEvent | { kind: "flight"; flight: Flight };
          try {
            item = JSON.parse(line);
          } catch {
            return;
          }
          if (item.kind === "flight") {
            flight = item.flight;
            const landedFlight = item.flight;
            set((r) => ({ ...r, flight: landedFlight }));
            return;
          }
          const event = item;
          set((r) => ({ ...r, events: [...r.events, event] }));
          // Every Pioneer call changed (or read) the hive: look again at once.
          if (event.kind === "result" && isHive(event)) {
            if (mode === "follower" && hiveVerb(event.name) === "waggle" && !event.text.startsWith("NO ROUTE")) {
              setWarnedAbout((n) => n ?? hiveRef.current.sites.length);
            }
            void refreshHive();
          }
        };
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          lines.forEach(handle);
        }
        handle(buffer);
      } catch (e) {
        error = message(e);
      }
      if (!flight && !error) error = "The flight ended without a result.";
      set((r) => ({ ...r, running: false, error }));
      return flight;
    },
    [refreshHive],
  );

  const reset = useCallback(async () => {
    const r = await fetch("/api/v1/demo/reset", { method: "POST" });
    if (!r.ok) {
      const body = (await r.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error || `The reset failed (${r.status}).`);
    }
    await refreshHive();
  }, [refreshHive]);

  const clear = () => {
    setPioneer(IDLE);
    setFollower(IDLE);
    setProblem(null);
    setWarnedAbout(null);
  };

  const runDemo = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    clear();
    setEmptied(false);
    setPhase("reset");
    try {
      await reset();
      setEmptied(true);
      await sleep(1500);
      setPhase("pioneer");
      const first = await fly("pioneer", setPioneer);
      await refreshHive();
      if (first?.landed) {
        setPhase("gap");
        await sleep(1500);
        setPhase("follower");
        await fly("follower", setFollower);
        await refreshHive();
      }
    } catch (e) {
      setProblem(message(e));
    } finally {
      setPhase("done");
      busy.current = false;
    }
  }, [fly, refreshHive, reset]);

  const resetOnly = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    clear();
    setPhase("idle");
    try {
      await reset();
    } catch (e) {
      setProblem(message(e));
      setPhase("done");
    } finally {
      busy.current = false;
    }
  }, [reset]);

  // First paint: show what the hive holds, and start by itself with ?autoplay=1.
  useEffect(() => {
    void refreshHive();
    if (new URLSearchParams(window.location.search).get("autoplay") !== "1") return;
    const id = setTimeout(() => void runDemo(), 2000);
    return () => clearTimeout(id);
  }, [refreshHive, runDemo]);

  // While an agent is in the air the hive is polled, and Realtime nudges it sooner.
  const flying = pioneer.running || follower.running;
  useEffect(() => {
    if (!flying) return;
    const id = setInterval(() => void refreshHive(), 1500);
    return () => clearInterval(id);
  }, [flying, refreshHive]);

  useEffect(() => {
    const sb = supabaseBrowser();
    if (!sb) return;
    const nudge = () => void refreshHive();
    const channel = sb
      .channel("demo-hive")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "maydays" }, nudge)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "flares" }, nudge)
      .on("postgres_changes", { event: "*", schema: "public", table: "routes" }, nudge)
      .subscribe();
    return () => {
      void sb.removeChannel(channel);
    };
  }, [refreshHive]);

  // The page fills the viewport under the nav, so the recording never scrolls.
  useEffect(() => {
    const measure = () => {
      const el = root.current;
      if (el) el.style.setProperty("--demo-top", `${Math.round(el.getBoundingClientRect().top + window.scrollY)}px`);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // --- what the screen says, derived from the flights and the hive -----------
  const knownSites = hive.sites.length;
  const flareCount = hive.sites.reduce((n, s) => n + s.flares.length, 0);
  const routeKnown = hive.routes.length > 0;
  const notified =
    flareCount > 0 || routeKnown || pioneer.events.some((e) => e.kind === "result" && e.ok !== false && (hiveVerb(e.name) === "flare" || hiveVerb(e.name) === "chart_route"));
  const pioneerRefused = refusedOf(pioneer);
  const followerRefused = refusedOf(follower);
  const pioneerPaid = pioneer.events.some((e) => e.kind === "result" && e.name === "create_payout" && e.ok);
  const followerPaid = follower.events.some((e) => e.kind === "result" && e.name === "create_payout" && e.ok);
  const firstCall = follower.events.findIndex((e) => e.kind === "tool");
  const askedFirst = firstCall >= 0 && hiveVerb(follower.events[firstCall].name) === "waggle";
  const busyNow = phase !== "idle" && phase !== "done";

  const step = phase === "idle" ? 0 : phase === "reset" ? 1 : phase === "pioneer" ? (notified ? 3 : 2) : phase === "gap" ? 3 : 4;
  const pioneerOk = Boolean(pioneer.flight?.landed);
  const followerOk = Boolean(follower.flight?.landed);
  const success = phase === "done" && !problem && pioneerOk && followerOk;

  const landedLine =
    followerRefused === 0 ? "Agent 2 lands on its first call. It never hit the failures." : `Agent 2 landed after ${plural(followerRefused, "refused call", "refused calls")}.`;
  let caption: string;
  if (phase === "idle") caption = "Press Run the demo: a real model is about to fly an API it has never seen.";
  else if (phase === "reset") caption = emptied && knownSites === 0 && !routeKnown ? "The hive knows nothing about this API." : "Emptying the demo airspace, so the first agent really is first.";
  else if (phase === "pioneer") {
    if (notified || pioneerPaid) caption = "Agent 1 got through and left the fix for whoever comes next.";
    else if (knownSites > 0) caption = `Each failure is reported. The hive now knows ${knownSites === 1 ? "this crash site" : `${knownSites} crash sites`}.`;
    else if (pioneerRefused > 0) caption = "Agent 1 follows the vendor's docs. The API refuses it.";
    else caption = "Agent 1 follows the vendor's docs.";
  } else if (phase === "gap") caption = "The hive now holds the failures and the fix. A second agent gets the same task.";
  else if (phase === "follower") {
    if (followerPaid) caption = landedLine;
    else if (warnedAbout != null) caption = `The hive warns Agent 2 about ${plural(warnedAbout, "failure point", "failure points")} before it tries.`;
    else caption = "Agent 2 asks the hive before it tries.";
  } else if (success) caption = landedLine;
  else if (problem) caption = "The demo could not finish. Run it again.";
  else if (!pioneerOk) caption = "Agent 1 did not land this time, so no route was charted. Run it again.";
  else caption = "Agent 2 did not land this time. Run it again.";

  return (
    <div ref={root} className="flex flex-col gap-3 pb-24 pt-4 lg:h-[calc(100dvh-var(--demo-top,65px))] lg:min-h-[620px] lg:pb-[76px]">
      <style>{`
        @keyframes demo-pulse {
          0% { box-shadow: 0 0 0 0 rgba(184, 15, 38, 0.75); background-color: rgba(184, 15, 38, 0.3); }
          100% { box-shadow: 0 0 0 16px rgba(184, 15, 38, 0); background-color: rgba(184, 15, 38, 0); }
        }
        .demo-pulse { animation: demo-pulse 1.2s ease-out 1 both; }
      `}</style>

      <header className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <span className="label">Product demo</span>
          <h1 className="mt-1 text-3xl font-extrabold! tracking-tight text-ink sm:text-4xl">One agent fails. The next one is warned.</h1>
          <p className="mt-1.5 text-base text-ink/80">A real model flies an API no model has seen. Nothing is scripted.</p>
        </div>
        <div className="flex flex-col gap-2.5 xl:items-end">
          <div className="flex items-center gap-2.5">
            <Button onClick={() => void runDemo()} disabled={busyNow} className="px-7 py-3 text-base">
              {busyNow ? "Running…" : phase === "done" ? "Run again" : "Run the demo"}
            </Button>
            <Button variant="ghost" onClick={() => void resetOnly()} disabled={busyNow} className="px-4 py-2 text-xs">
              Reset
            </Button>
          </div>
          <StepIndicator step={step} complete={success} />
        </div>
      </header>

      {phase === "done" ? (
        <section className="animate-rise rounded-2xl border border-ink bg-comb px-5 py-4" aria-live="polite">
          {problem ? (
            <p className="text-xl font-bold text-distress">The demo could not finish: {problem}</p>
          ) : !pioneerOk ? (
            <p className="text-xl font-bold text-ink">
              Agent 1 did not land{pioneer.error ? `: ${pioneer.error}` : ""}. It was refused {plural(pioneerRefused, "time", "times")} and reported{" "}
              {plural(knownSites, "failure point", "failure points")}, but no route was charted, so Agent 2 was not flown.
            </p>
          ) : !followerOk ? (
            <p className="text-xl font-bold text-ink">
              Agent 1 hit {plural(knownSites, "failure point", "failure points")} and was refused {plural(pioneerRefused, "time", "times")}. Agent 2 did not land
              {follower.error ? `: ${follower.error}` : ` (refused ${plural(followerRefused, "time", "times")})`}.
            </p>
          ) : (
            <p className="text-xl font-bold leading-tight text-ink xl:text-2xl">
              Agent 1 hit <Big tone="text-distress">{knownSites}</Big> {knownSites === 1 ? "failure point" : "failure points"} and was refused
              <Big tone="text-distress">{pioneerRefused}</Big> {pioneerRefused === 1 ? "time" : "times"}. Agent 2 was warned and was refused
              <Big tone="text-ink">{followerRefused}</Big> {followerRefused === 1 ? "time" : "times"}.
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            {success && followerRefused === 0 ? (
              <span className="rounded-full border border-flare/60 bg-flare/10 px-4 py-2 text-base font-extrabold text-flare">Failure points avoided: {knownSites}</span>
            ) : null}
            {!success ? (
              <Button onClick={() => void runDemo()} className="px-6">
                Run again
              </Button>
            ) : null}
            <ButtonLink href={`/tower/${AIRSPACE}`} variant="ghost" className="py-2">
              Open the vendor&apos;s tower
            </ButtonLink>
            <ButtonLink href="/matching" variant="ghost" className="py-2">
              See how Postgres matched the errors
            </ButtonLink>
          </div>
        </section>
      ) : null}

      <div className="grid min-h-0 grid-cols-1 gap-3 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.82fr)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
        <AgentColumn title="Agent 1 · first to try" run={pioneer} waiting="Agent 1 has not taken off yet." />
        <HiveColumn hive={hive} emptied={phase === "reset" && emptied} />
        <AgentColumn
          title="Agent 2 · next to try"
          run={follower}
          waiting="Agent 2 flies after Agent 1 has reported."
          highlightIndex={askedFirst ? firstCall : undefined}
          callouts={
            askedFirst || warnedAbout != null ? (
              <div className="flex flex-wrap gap-2">
                {askedFirst ? <Callout>Asked the hive before flying</Callout> : null}
                {warnedAbout != null ? <Callout>Warned about {plural(warnedAbout, "failure point", "failure points")}</Callout> : null}
              </div>
            ) : null
          }
        />
      </div>

      {/* The recording has no presenter: this line says what is happening. */}
      <div className="terminal fixed inset-x-0 bottom-0 z-50 rounded-none! border-t border-comb/20 px-4 py-3.5 sm:px-8" role="status" aria-live="polite">
        <div className="mx-auto flex max-w-[1440px] items-center gap-3 sm:gap-4">
          <span className="shrink-0 rounded-full border border-comb/40 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-comb/80">
            {step === 0 ? "Ready" : success ? "Done" : `Step ${step} of 4`}
          </span>
          <p key={caption} className="min-w-0 animate-rise text-lg font-semibold leading-snug tracking-[-0.01em] text-comb sm:text-2xl">
            {caption}
          </p>
        </div>
      </div>
    </div>
  );
}
