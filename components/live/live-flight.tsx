"use client";

import Link from "next/link";
import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Flight, FlightEvent, FlightMode, FlightStat } from "@/lib/types";
import { Button } from "@/components/ui";
import { FLIGHT_INSTRUCTIONS, MAX_TURNS } from "./instructions";

type Run = { events: FlightEvent[]; running: boolean; flight: Flight | null; error: string | null; startedAt: number | null; elapsed: number };
const IDLE: Run = { events: [], running: false, flight: null, error: null, startedAt: null, elapsed: 0 };

const CARD = "rounded-2xl border border-ink/15 bg-panel";
const TITLES: Record<FlightMode, string> = { solo: "Flying alone", follower: "Flying with the hive", pioneer: "Flying as the pioneer" };
const MODE_ORDER: FlightMode[] = ["solo", "pioneer", "follower"];
const MODE_NAME: Record<FlightMode, string> = { solo: "Alone", pioneer: "Pioneer (charts the route)", follower: "With the hive" };
const CAVEAT =
  "Every number here comes from flights flown on this page. Small sample, one scenario: it shows the loop on an API a model cannot know, not a benchmark.";

const isRefused = (e: FlightEvent) => e.kind === "result" && e.name === "create_payout" && e.ok === false;
const isMayday = (e: FlightEvent) => Boolean(e.name?.startsWith("mayday_"));
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function Collapsible({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const lines = text.split("\n");
  const long = lines.length > 6;
  return (
    <div className={className}>
      <pre className="whitespace-pre-wrap break-words font-mono">{open || !long ? text : lines.slice(0, 6).join("\n")}</pre>
      {long ? (
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-comb/70 underline underline-offset-2 hover:text-comb">
          {open ? "Collapse" : `Expand (${lines.length - 6} more lines)`}
        </button>
      ) : null}
    </div>
  );
}

function EventLine({ e }: { e: FlightEvent }) {
  if (e.kind === "start") return <div className="text-comb/60">take-off · {e.text}</div>;
  if (e.kind === "think") return <Collapsible text={e.text} className="text-comb/70 italic" />;
  if (e.kind === "error") return <div className="text-distress">error: {e.text}</div>;
  if (e.kind === "done") return <div className={clsx("mt-2 font-bold", e.ok ? "text-comb" : "text-distress")}>{e.text}</div>;
  if (e.kind === "tool") {
    return <div className={clsx("mt-2 break-words", isMayday(e) ? "text-flare" : "text-comb")}>$ {e.text}</div>;
  }
  // results
  if (isMayday(e)) return <Collapsible text={e.text} className={e.ok === false ? "text-distress" : "text-flare"} />;
  if (e.name === "create_payout") {
    return e.ok ? <div className="font-bold text-comb">paid: {e.text}</div> : <div className="break-words text-distress">refused: {e.text}</div>;
  }
  return <div className={clsx("break-words", e.ok === false ? "text-distress" : "text-comb/60")}>{e.text}</div>;
}

function Terminal({ mode, run, onLaunch, notice, compact }: { mode: FlightMode; run: Run; onLaunch: () => void; notice?: React.ReactNode; compact?: boolean }) {
  const well = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = well.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [run.events.length]);

  const refused = run.events.filter(isRefused).length;
  const done = run.events.find((e) => e.kind === "done");
  const landed = run.flight ? run.flight.landed : done?.ok;
  const finished = !run.running && (run.flight || done);

  return (
    <section className={clsx(CARD, "flex min-w-0 flex-col p-4 sm:p-5")} aria-label={TITLES[mode]}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="label">{mode === "solo" ? "No Mayday" : mode === "follower" ? "Mayday: follows the route" : "Mayday: first agent here"}</span>
          <h2 className="text-xl font-extrabold! tracking-tight text-ink sm:text-2xl">{TITLES[mode]}</h2>
        </div>
        <Button onClick={onLaunch} disabled={run.running} variant={mode === "solo" ? "primary" : "flare"}>
          {run.running ? "Flying…" : run.events.length ? "Launch again" : "Launch"}
        </Button>
      </div>
      {notice}
      <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 font-mono text-sm text-ink">
        <span>
          Refused calls: <span className={clsx("tabular text-lg font-bold", refused ? "text-distress" : "text-ink")}>{refused}</span>
        </span>
        <span className="tabular text-ink/70">{secs(run.flight ? run.flight.seconds * 1000 : run.elapsed)}</span>
        {finished ? (
          <span className={clsx("font-sans font-bold", landed ? "text-ink" : "text-distress")}>
            {landed ? `Landed after ${refused} refused ${refused === 1 ? "call" : "calls"}` : `Did not land in ${MAX_TURNS} turns`}
          </span>
        ) : null}
      </div>
      <div
        ref={well}
        className={clsx("terminal mt-3 overflow-y-auto px-4 py-3 font-mono text-[12.5px] leading-relaxed text-comb [scrollbar-width:thin]", compact ? "h-64" : "h-[26rem]")}
        aria-live="polite"
      >
        {run.events.length === 0 && !run.error ? <div className="text-comb/50">Ready on the runway. Press Launch.</div> : null}
        {run.events.map((e, i) => (
          <EventLine key={i} e={e} />
        ))}
        {run.error ? <div className="text-distress">error: {run.error}</div> : null}
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
    <div className="mt-8 flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => {
            void launch("solo");
            void launch("follower");
          }}
          disabled={runs.solo.running || runs.follower.running}
        >
          Launch both
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
          Tools: read_docs and create_payout for every mode; the Mayday tools only for the pioneer and the follower. The model cannot see the SDK source.
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
