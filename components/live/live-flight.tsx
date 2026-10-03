"use client";

import Link from "next/link";
import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Flight, FlightEvent, FlightMode, FlightStat } from "@/lib/types";
import { Button } from "@/components/ui";
import { FLIGHT_INSTRUCTIONS } from "./instructions";

type Run = { events: FlightEvent[]; running: boolean; flight: Flight | null; error: string | null; startedAt: number | null; elapsed: number };
const IDLE: Run = { events: [], running: false, flight: null, error: null, startedAt: null, elapsed: 0 };

const CARD = "rounded-2xl border border-ink/15 bg-panel";
const TITLES: Record<FlightMode, string> = { solo: "Flying alone", follower: "Flying with the hive", pioneer: "Flying as the pioneer" };
const MODE_ORDER: FlightMode[] = ["solo", "pioneer", "follower"];
const MODE_NAME: Record<FlightMode, string> = { solo: "Alone", pioneer: "Pioneer (charts the route)", follower: "With the hive" };
const CAVEAT =
  "Every number here comes from flights flown on this page. Small sample, one scenario: it shows the loop on an API a model cannot know, not a benchmark.";

const isRefused = (e: FlightEvent) => e.kind === "result" && e.name === "create_payout" && e.ok === false;
// The hive's own tools are every tool that is not the task's (read_docs, create_payout).
// Told apart this way, the colouring does not depend on what the tools are named.
const TASK_TOOLS = new Set(["read_docs", "create_payout"]);
const isMayday = (e: FlightEvent) => Boolean(e.name && !TASK_TOOLS.has(e.name));
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

// Colours for the dark well. The page's red and burnt honey are tuned for the
// yellow field and are too dark to read on black, so the well has its own.
const WELL_RED = "text-[#ff9a9a]";
const WELL_AMBER = "text-[#ffc55c]";

function Collapsible({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const lines = text.split("\n");
  const long = lines.length > 6;
  return (
    <div className={className}>
      <pre className="whitespace-pre-wrap font-mono [overflow-wrap:anywhere]">{open || !long ? text : lines.slice(0, 6).join("\n")}</pre>
      {long ? (
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-comb/70 underline underline-offset-2 hover:text-comb">
          {open ? "Collapse" : `Expand (${lines.length - 6} more lines)`}
        </button>
      ) : null}
    </div>
  );
}

// A tool call arrives as `name {json}`. The arguments are printed one per line,
// exactly as the model sent them, so a JSON string inside JSON is not shown
// with every quote escaped.
function CallLine({ text, tone }: { text: string; tone: string }) {
  const space = text.indexOf(" ");
  const name = space < 0 ? text : text.slice(0, space);
  let args: Record<string, unknown> | null = null;
  if (space > 0) {
    try {
      const parsed: unknown = JSON.parse(text.slice(space + 1));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
    } catch {
      args = null;
    }
  }
  if (!args) return <div className={clsx("mt-2", tone)}>$ {text}</div>;
  return (
    <div className={clsx("mt-2", tone)}>
      <div className="font-bold">$ {name}</div>
      {Object.entries(args).map(([key, value]) => (
        <div key={key} className="pl-4">
          <span className="opacity-60">{key}</span> {typeof value === "string" ? value : JSON.stringify(value)}
        </div>
      ))}
    </div>
  );
}

function EventLine({ e }: { e: FlightEvent }) {
  if (e.kind === "start") return <div className="text-comb/65">take-off · {e.text}</div>;
  if (e.kind === "think") return <Collapsible text={e.text} className="text-comb/75 italic" />;
  if (e.kind === "error") return <div className={WELL_RED}>error: {e.text}</div>;
  if (e.kind === "done") {
    return <div className={clsx("mt-3 border-t border-comb/25 pt-2 text-[1.08em] font-bold", e.ok ? "text-comb" : WELL_RED)}>{e.text}</div>;
  }
  if (e.kind === "tool") return <CallLine text={e.text} tone={isMayday(e) ? WELL_AMBER : "text-comb"} />;
  // results
  if (isMayday(e)) return <Collapsible text={e.text} className={e.ok === false ? WELL_RED : WELL_AMBER} />;
  if (e.name === "create_payout") {
    return e.ok ? (
      <div className="font-bold text-comb">paid: {e.text}</div>
    ) : (
      <div className={WELL_RED}>
        <span className="font-bold">refused:</span> {e.text}
      </div>
    );
  }
  return <div className={e.ok === false ? WELL_RED : "text-comb/65"}>{e.text}</div>;
}

function Terminal({ mode, run, onLaunch, notice, compact }: { mode: FlightMode; run: Run; onLaunch: () => void; notice?: React.ReactNode; compact?: boolean }) {
  const well = useRef<HTMLDivElement>(null);
  // The newest line is always in view: on every event, and once more when the
  // flight ends and the cursor line goes away.
  useEffect(() => {
    const el = well.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [run.events.length, run.running, run.error]);

  const done = run.events.find((e) => e.kind === "done");
  // The saved flight's count is the server's; until it arrives, count what streamed.
  const refused = run.flight ? run.flight.failed_attempts : run.events.filter(isRefused).length;
  const landed = run.flight ? run.flight.landed : done?.ok === true;
  const finished = !run.running && Boolean(run.flight || done);
  const idle = !run.running && !finished && !run.error;
  const calls = `${refused} refused ${refused === 1 ? "call" : "calls"}`;

  // One line the back of the room can read.
  const headline = run.running
    ? "In the air…"
    : finished
      ? landed
        ? refused === 0
          ? "Landed first try"
          : `Landed after ${calls}`
        : `Did not land: ${calls}`
      : run.error
        ? "The flight did not finish"
        : "Ready on the runway";

  return (
    <section className={clsx(CARD, "flex min-w-0 flex-col p-4 sm:p-5")} aria-label={TITLES[mode]}>
      <div className="flex items-stretch justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="label">{mode === "solo" ? "Alone, from the docs" : mode === "follower" ? "With the hive: follows the route" : "With the hive: first agent here"}</span>
          <h2 className="mt-0.5 text-xl font-extrabold! tracking-tight text-ink sm:text-2xl">{TITLES[mode]}</h2>
          <p
            className={clsx(
              "mt-2 flex min-h-[2.1em] items-center text-[1.4rem] font-extrabold leading-[1.05] tracking-[-0.03em] text-balance sm:text-3xl xl:text-[2.1rem]",
              finished || run.error ? (landed && !run.error ? "text-ink" : "text-distress") : "text-ink/45",
            )}
            aria-live="polite"
          >
            {headline}
          </p>
          <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-2">
            <Button onClick={onLaunch} disabled={run.running} variant={mode === "solo" ? "primary" : "flare"}>
              {run.running ? "Flying…" : run.events.length ? "Launch again" : "Launch"}
            </Button>
            <span className="tabular font-mono text-base font-semibold text-ink/75">{secs(run.flight ? run.flight.seconds * 1000 : run.elapsed)}</span>
          </div>
        </div>
        {/* The number the room came for. */}
        <div className="flex shrink-0 flex-col items-end justify-between">
          <span className="label whitespace-nowrap">Refused calls</span>
          <span
            className={clsx(
              "tabular text-[6.5rem] font-extrabold leading-[0.82] tracking-[-0.06em] sm:text-[9rem] xl:text-[10.5rem]",
              refused ? "text-distress" : idle ? "text-ink/30" : "text-ink",
            )}
            data-testid={`refused-${mode}`}
          >
            {refused}
          </span>
        </div>
      </div>
      {notice}
      <div
        ref={well}
        className={clsx(
          "terminal mt-4 overflow-y-auto overflow-x-hidden px-4 py-3 font-mono text-[12.5px] leading-relaxed text-comb [overflow-wrap:anywhere] [scrollbar-width:thin]",
          compact ? "h-64" : "h-[clamp(16rem,calc(100dvh-35.5rem),34rem)]",
        )}
        aria-live="off"
      >
        {run.events.length === 0 && !run.error ? <div className="text-comb/55">Ready on the runway. Press Launch.</div> : null}
        {run.events.map((e, i) => (
          <EventLine key={i} e={e} />
        ))}
        {run.error ? <div className={WELL_RED}>error: {run.error}</div> : null}
        {run.running ? <div className="mt-1 animate-pulse text-comb/60">▍</div> : null}
      </div>
    </section>
  );
}

export function LiveFlight({ initialStats, initialFlights, initialHasRoute }: { initialStats: FlightStat[]; initialFlights: Flight[]; initialHasRoute: boolean | null }) {
  const [runs, setRuns] = useState<Record<FlightMode, Run>>({ solo: IDLE, follower: IDLE, pioneer: IDLE });
  const [stats, setStats] = useState(initialStats);
  const [flights, setFlights] = useState(initialFlights);
  const [hasRoute, setHasRoute] = useState(initialHasRoute);
  const [showPioneer, setShowPioneer] = useState(false);
  const busy = useRef<Record<FlightMode, boolean>>({ solo: false, follower: false, pioneer: false });

  const patch = useCallback((mode: FlightMode, fn: (r: Run) => Run) => setRuns((all) => ({ ...all, [mode]: fn(all[mode]) })), []);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/v1/flight", { cache: "no-store" });
      if (r.ok) {
        const d = (await r.json()) as { stats: FlightStat[]; flights: Flight[] };
        setStats(d.stats ?? []);
        setFlights(d.flights ?? []);
      }
    } catch {
      // keep the last scoreboard
    }
    try {
      const r = await fetch("/api/v1/waggle?vendor=hivepay", { cache: "no-store" });
      if (r.ok) setHasRoute(((await r.json()) as { routes?: unknown[] }).routes?.length ? true : false);
    } catch {
      // unknown stays unknown
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The clocks tick while a flight is in the air.
  const anyRunning = runs.solo.running || runs.follower.running || runs.pioneer.running;
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => {
      setRuns((all) => {
        const next = { ...all };
        for (const m of MODE_ORDER) if (all[m].running && all[m].startedAt) next[m] = { ...all[m], elapsed: Date.now() - all[m].startedAt! };
        return next;
      });
    }, 100);
    return () => clearInterval(id);
  }, [anyRunning]);

  const launch = useCallback(
    async (mode: FlightMode) => {
      if (busy.current[mode]) return;
      busy.current[mode] = true;
      if (mode === "pioneer") setShowPioneer(true);
      patch(mode, () => ({ ...IDLE, running: true, startedAt: Date.now() }));
      try {
        const res = await fetch("/api/v1/flight", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error || `The flight could not start (${res.status}).`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const handle = (line: string) => {
          if (!line.trim()) return;
          let item: (FlightEvent & { flight?: Flight }) | { kind: "flight"; flight: Flight };
          try {
            item = JSON.parse(line);
          } catch {
            return;
          }
          if (item.kind === "flight") {
            const flight = (item as { flight: Flight }).flight;
            patch(mode, (r) => ({ ...r, flight }));
          } else {
            const event = item as FlightEvent;
            patch(mode, (r) => ({ ...r, events: [...r.events, event] }));
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
        handle(buffer + decoder.decode());
      } catch (e) {
        patch(mode, (r) => ({ ...r, error: e instanceof Error ? e.message : "The flight was interrupted." }));
      } finally {
        patch(mode, (r) => ({ ...r, running: false, elapsed: r.startedAt ? Date.now() - r.startedAt : r.elapsed }));
        busy.current[mode] = false;
        void refresh();
      }
    },
    [patch, refresh],
  );

  const byMode = (m: FlightMode) => stats.find((s) => s.mode === m);

  return (
    <div className="mt-5 flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => {
            void launch("solo");
            void launch("follower");
          }}
          disabled={runs.solo.running || runs.follower.running}
          className="px-7! py-3! text-base!"
        >
          {runs.solo.running || runs.follower.running ? "Flying…" : "Launch both"}
        </Button>
        <Button variant="ghost" onClick={() => void launch("pioneer")} disabled={runs.pioneer.running} className="px-4! py-2! text-[13px]!">
          {runs.pioneer.running ? "Pioneer flying…" : "Fly as the pioneer"}
        </Button>
        <span className="text-sm text-ink/70">The pioneer charts the route; it is needed once before the follower has anything to follow.</span>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Terminal mode="solo" run={runs.solo} onLaunch={() => void launch("solo")} />
        <Terminal
          mode="follower"
          run={runs.follower}
          onLaunch={() => void launch("follower")}
          notice={
            hasRoute === false ? (
              <p className="mt-3 rounded-xl border border-flare/50 bg-flare/10 px-3 py-2 text-sm text-ink">
                No HivePay route is charted yet, so the hive has nothing to hand over. Press <span className="font-semibold">Fly as the pioneer</span> once first.
              </p>
            ) : null
          }
        />
      </div>

      {showPioneer || runs.pioneer.events.length ? <Terminal mode="pioneer" run={runs.pioneer} onLaunch={() => void launch("pioneer")} compact /> : null}

      <section className={clsx(CARD, "p-5 sm:p-6")} aria-label="Scoreboard">
        <span className="label">Scoreboard</span>
        <h2 className="mt-1 text-2xl font-extrabold! tracking-tight text-ink">Flights flown on this page</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm text-ink">
            <thead>
              <tr className="border-b border-ink/15 font-mono text-[11px] uppercase tracking-[0.14em] text-mute">
                <th className="py-2 pr-4 font-normal">Mode</th>
                <th className="py-2 pr-4 font-normal">Flights</th>
                <th className="py-2 pr-4 font-normal">Landed</th>
                <th className="py-2 pr-4 font-normal">Avg refused calls</th>
                <th className="py-2 font-normal">Avg seconds</th>
              </tr>
            </thead>
            <tbody>
              {MODE_ORDER.map((m) => {
                const s = byMode(m);
                return (
                  <tr key={m} className="border-b border-ink/10 last:border-0">
                    <td className="py-2.5 pr-4 font-semibold">{MODE_NAME[m]}</td>
                    <td className="tabular py-2.5 pr-4">{s ? s.flights : 0}</td>
                    <td className="tabular py-2.5 pr-4">{s ? s.landed : 0}</td>
                    <td className={clsx("tabular py-2.5 pr-4 text-lg font-bold", s && s.avg_failed_attempts >= 1 ? "text-distress" : "text-ink")}>
                      {s ? s.avg_failed_attempts.toFixed(1) : "–"}
                    </td>
                    <td className="tabular py-2.5">{s ? s.avg_seconds.toFixed(1) : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {flights.length ? (
          <p className="mt-3 font-mono text-xs text-ink/70">
            Last flights:{" "}
            {flights.slice(0, 8).map((f, i) => (
              <span key={f.id}>
                {i ? " · " : ""}
                {f.mode} {f.landed ? `landed, ${f.failed_attempts} refused` : "did not land"}
              </span>
            ))}
          </p>
        ) : null}
        <p className="mt-4 max-w-3xl text-sm text-ink/75">{CAVEAT}</p>
      </section>

      <details className={clsx(CARD, "p-5 sm:p-6")}>
        <summary className="cursor-pointer text-lg font-extrabold! tracking-tight text-ink">What the agent was told</summary>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {MODE_ORDER.map((m) => (
            <div key={m}>
              <span className="label">{MODE_NAME[m]}</span>
              <p className="terminal mt-2 px-4 py-3 font-mono text-[12.5px] leading-relaxed text-comb">{FLIGHT_INSTRUCTIONS[m]}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm text-ink/75">
          Tools: read_docs and create_payout for every mode; the hive tools (report, flare, route, landing) only for the pioneer and the follower. The model cannot see the SDK source.
        </p>
      </details>

      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold text-ink">
        <a href="/live/docs" target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-flare">
          The outdated HivePay docs the agent reads
        </a>
        <Link href="/waggle" className="underline underline-offset-4 hover:text-flare">
          Waggle routes: what the pioneer charted
        </Link>
      </div>
    </div>
  );
}
