"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Play, SkipForward } from "lucide-react";
import { Button } from "@/components/ui";
import { CAP, PALE_RED, TCAP, TSCROLL, TSELECT } from "@/components/cockpit/theme";
import type { ReplayEntry, ReplayKind } from "./replay-types";

const STEP_MS = 700;
const REFRESH_MS = 20_000;

// Re-reads the server data while the flights are still in progress.
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [active, router]);
  return null;
}

// Data colours light enough for the dark well: red for stop signals, honey for
// flares, pale wax for everything else.
const TONE: Record<ReplayKind, string> = {
  mayday: PALE_RED,
  flare: "text-bg",
  route: "text-bg",
  ask: "text-comb",
  rescue: "text-comb",
  landed: "text-comb",
};

function Steps({ task, steps }: { task?: string; steps?: { n: number; text: string }[] }) {
  return (
    <>
      {task ? <p className="mt-2 text-sm leading-relaxed text-comb [overflow-wrap:anywhere]">{task}</p> : null}
      {steps?.length ? (
        <ol className="mt-2 space-y-1.5 border-l border-comb/20 pl-3">
          {steps.map((s) => (
            <li key={s.n} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 font-mono text-xs leading-relaxed text-comb/85">
              <span className="tabular select-none text-comb/45">{s.n}.</span>
              <span className="[overflow-wrap:anywhere]">{s.text}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </>
  );
}

function Entry({ e, index, animate }: { e: ReplayEntry; index: number; animate: boolean }) {
  return (
    <li className={clsx("grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 px-4 py-4 sm:px-5", animate && "animate-rise")}>
      <span className="tabular select-none pt-px font-mono text-[11px] text-comb/45" aria-hidden>
        {String(index + 1).padStart(2, "0")}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={clsx(CAP, "font-semibold", TONE[e.kind])}>{e.head}</span>
          {e.tag ? (
            <span className="rounded-full border border-comb/30 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-comb/70">
              {e.tag}
            </span>
          ) : null}
          {e.clock ? <span className="tabular ml-auto font-mono text-[11px] text-comb/50">{e.clock}</span> : null}
        </div>

        {e.error ? <p className="mt-2 font-mono text-[13px] leading-relaxed text-comb [overflow-wrap:anywhere]">{e.error}</p> : null}
        {e.body ? <p className="mt-2 text-sm leading-relaxed text-comb [overflow-wrap:anywhere]">{e.body}</p> : null}
        {e.snippet ? (
          <pre
            className={clsx(
              "mt-2 max-h-40 overflow-auto rounded-lg border border-comb/15 px-3 py-2 font-mono text-xs leading-relaxed text-comb/85",
              TSCROLL,
            )}
          >
            <code>{e.snippet}</code>
          </pre>
        ) : null}
        {e.kind === "route" || e.kind === "ask" ? <Steps task={e.task} steps={e.steps} /> : null}

        {e.site ? (
          <p className="mt-2 font-mono text-xs leading-relaxed text-comb/60 [overflow-wrap:anywhere]">
            crash site:{" "}
            <Link
              href={`/site/${e.site.slug}`}
              className="text-comb underline decoration-comb/40 underline-offset-4 hover:decoration-comb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-comb"
            >
              {e.site.title}
            </Link>
          </p>
        ) : null}
        {e.note ? <p className="mt-2 font-mono text-xs leading-relaxed text-comb/60 [overflow-wrap:anywhere]">{e.note}</p> : null}

        {e.attempts?.length ? (
          <details className="mt-2">
            <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.14em] text-comb/60 hover:text-comb focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-comb">
              Black box · {e.attempts.length} {e.attempts.length === 1 ? "step" : "steps"}
            </summary>
            <ol className="mt-2 space-y-1.5 border-l border-comb/20 pl-3">
              {e.attempts.map((a, i) => (
                <li key={i} className="font-mono text-xs leading-relaxed text-comb/75 [overflow-wrap:anywhere]">
                  <span className="select-none text-comb/45">{a.step}. </span>
                  {a.action}
                  {a.result ? (
                    <>
                      <span className="select-none text-comb/45"> → </span>
                      {a.result}
                    </>
                  ) : null}
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </div>
    </li>
  );
}

function Column({
  role,
  agent,
  entries,
  shown,
  playing,
  waiting,
}: {
  role: string;
  agent: string;
  entries: ReplayEntry[];
  shown: number;
  playing: boolean;
  waiting: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const visible = entries.slice(0, shown);

  // While a replay plays, keep the newest entry in view inside the well.
  useEffect(() => {
    const el = scroller.current;
    if (playing && el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [playing, visible.length]);

  return (
    <section className={clsx("terminal flex min-w-0 flex-col overflow-hidden", TSELECT)} aria-label={`${role} timeline`}>
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-comb/15 px-4 py-3 sm:px-5">
        <span className="flex min-w-0 items-baseline gap-3">
          <span className={clsx(CAP, "font-semibold text-bg")}>{role}</span>
          <span className="truncate font-mono text-xs text-comb/70">{agent}</span>
        </span>
        <span className={clsx(TCAP, "tabular")}>
          {visible.length}/{entries.length} recorded
        </span>
      </header>
      <div ref={scroller} className={clsx("min-h-40 flex-1 overflow-y-auto lg:h-[34rem]", TSCROLL)}>
        {entries.length === 0 ? (
          <p className="px-4 py-6 font-mono text-[13px] leading-relaxed text-comb/60 sm:px-5">{waiting}</p>
        ) : (
          <ol className="divide-y divide-comb/10">
            {visible.map((e, i) => (
              <Entry key={e.id} e={e} index={i} animate={playing} />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

export function FlightReplay({
  pioneer,
  follower,
  pioneerAgent,
  followerAgent,
  pioneerWaiting,
  followerWaiting,
}: {
  pioneer: ReplayEntry[];
  follower: ReplayEntry[];
  pioneerAgent: string;
  followerAgent: string;
  pioneerWaiting: string;
  followerWaiting: string;
}) {
  const total = Math.max(pioneer.length, follower.length);
  // null: everything is shown. A number: a replay is playing and that many
  // entries of each column are revealed.
  const [step, setStep] = useState<number | null>(null);
  const playing = step !== null;

  useEffect(() => {
    if (step === null) return;
    const id = setTimeout(() => setStep(step + 1 >= total ? null : step + 1), STEP_MS);
    return () => clearTimeout(id);
  }, [step, total]);

  function play() {
    // With reduced motion, or nothing to stagger, everything simply stays shown.
    const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setStep(reduced || total <= 1 ? null : 1);
  }

  const shown = step ?? total;

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="label" aria-live="polite">
          {playing ? `Replaying · step ${Math.min(shown, total)} of ${total}` : "Recorded timeline · oldest first"}
        </span>
        {playing ? (
          <Button type="button" variant="ghost" onClick={() => setStep(null)}>
            <SkipForward className="h-4 w-4" strokeWidth={2.25} aria-hidden />
            Show all
          </Button>
        ) : (
          <Button type="button" onClick={play} disabled={total === 0}>
            <Play className="h-4 w-4" strokeWidth={2.25} aria-hidden />
            Replay
          </Button>
        )}
      </div>
      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <Column role="First agent" agent={pioneerAgent} entries={pioneer} shown={shown} playing={playing} waiting={pioneerWaiting} />
        <Column role="Follower" agent={followerAgent} entries={follower} shown={shown} playing={playing} waiting={followerWaiting} />
      </div>
    </div>
  );
}
