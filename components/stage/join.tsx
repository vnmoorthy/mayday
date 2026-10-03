"use client";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import clsx from "clsx";
import { Bee } from "@/components/ui";
import type { Briefing, Flare } from "@/lib/types";
import { BEE_NAME, PRESETS, type Preset } from "./presets";

// Audience mode, phone side. One tap turns a person in the room into a bee:
// it flies into a real failure, gets the briefing every agent gets, and
// confirms the rescue. Every tap is a real mayday through the real API, so the
// big screen at /stage lights up. There is no text input on this page.

// --- the bee: a name and two running totals, kept in localStorage ------------

type BeeState = { name: string; down: number; rescued: number };

const STORE_KEY = "mayday-bee";
// No look-alike characters, so a name can be read off a phone and found on the screen.
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

function newName(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return `bee-${[...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("")}`;
}

const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

let cache: BeeState | null = null;
const listeners = new Set<() => void>();

function save(state: BeeState) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // Private mode or storage disabled: the bee still flies, it just forgets.
  }
}

function readBee(): BeeState {
  if (cache) return cache;
  let state: BeeState | null = null;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") {
      const p = parsed as Record<string, unknown>;
      // A stored name that is not bee-shaped is thrown away, not trusted.
      if (typeof p.name === "string" && BEE_NAME.test(p.name)) {
        state = { name: p.name, down: count(p.down), rescued: count(p.rescued) };
      }
    }
  } catch {
    state = null;
  }
  if (!state) {
    state = { name: newName(), down: 0, rescued: 0 };
    save(state);
  }
  cache = state;
  return state;
}

function bump(key: "down" | "rescued") {
  const cur = readBee();
  cache = { ...cur, [key]: cur[key] + 1 };
  save(cache);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const noBee = () => null;

// --- the API ----------------------------------------------------------------

const TIMEOUT_MS = 15_000;

async function post<T>(path: string, body: unknown): Promise<T> {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (!res.ok || !json || typeof json !== "object") {
      const said = json && typeof json === "object" && "error" in json ? String((json as { error: unknown }).error) : "";
      throw new Error(said || `The hive answered ${res.status}.`);
    }
    return json as T;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw new Error("The hive took too long to answer.");
    if (e instanceof TypeError) throw new Error("No signal. Check your connection and try again.");
    throw e;
  } finally {
    window.clearTimeout(timer);
  }
}

// The vendor's official fix first, then whichever flare got the most agents through.
function topFlare(flares: Flare[] | undefined): Flare | null {
  if (!Array.isArray(flares) || flares.length === 0) return null;
  return [...flares].sort(
    (a, b) => Number(b.kind === "official") - Number(a.kind === "official") || b.helped - a.helped,
  )[0];
}

// --- the page ---------------------------------------------------------------

type Phase =
  | { at: "pick" }
  | { at: "flying"; preset: Preset }
  | { at: "briefed"; preset: Preset; briefing: Briefing; flare: Flare | null; busy: boolean; error: string | null }
  | { at: "rescued"; preset: Preset }
  | { at: "failed"; preset: Preset; error: string };

const BIG_BUTTON =
  "flex min-h-16 w-full items-center justify-center rounded-full border border-ink bg-ink px-6 py-4 text-center text-lg font-extrabold tracking-[-0.01em] text-bg transition-colors active:bg-ink/80 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
const QUIET_BUTTON =
  "flex min-h-14 w-full items-center justify-center rounded-full border border-ink px-6 py-3 text-center text-base font-semibold text-ink transition-colors active:bg-ink active:text-bg disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

export function Join() {
  const bee = useSyncExternalStore(subscribe, readBee, noBee);
  const [phase, setPhase] = useState<Phase>({ at: "pick" });
  // A double tap must not send two maydays.
  const inFlight = useRef(false);

  const fly = useCallback(
    async (preset: Preset) => {
      if (!bee || inFlight.current) return;
      inFlight.current = true;
      setPhase({ at: "flying", preset });
      try {
        const briefing = await post<Briefing>("/api/v1/mayday", {
          error: preset.scenario.error,
          vendor: preset.scenario.vendor,
          agent: bee.name,
          minutes_lost: 3,
        });
        bump("down");
        setPhase({ at: "briefed", preset, briefing, flare: topFlare(briefing.flares), busy: false, error: null });
      } catch (e) {
        setPhase({ at: "failed", preset, error: e instanceof Error ? e.message : "The mayday did not go out." });
      } finally {
        inFlight.current = false;
      }
    },
    [bee],
  );

  const rescue = useCallback(async () => {
    if (!bee || inFlight.current || phase.at !== "briefed" || !phase.flare || !phase.briefing.site) return;
    const { preset, briefing, flare } = phase;
    inFlight.current = true;
    setPhase({ ...phase, busy: true, error: null });
    try {
      await post<unknown>("/api/v1/rescue", {
        site_id: briefing.site?.id,
        flare_id: flare?.id,
        mayday_id: briefing.mayday_id ?? null,
        agent: bee.name,
        minutes_saved: 3,
      });
      bump("rescued");
      setPhase({ at: "rescued", preset });
    } catch (e) {
      setPhase({ ...phase, busy: false, error: e instanceof Error ? e.message : "The rescue was not recorded." });
    } finally {
      inFlight.current = false;
    }
  }, [bee, phase]);

  const again = useCallback(() => setPhase({ at: "pick" }), []);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col gap-5 px-4 pb-10 pt-5">
      <header className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <Bee className="h-6 w-7 text-ink" />
          <span className="text-base font-extrabold tracking-[-0.03em] text-ink">MAYDAY</span>
        </span>
        <span className="label tabular whitespace-nowrap" aria-live="polite">
          Down {bee?.down ?? 0} · Rescued {bee?.rescued ?? 0}
        </span>
      </header>

      <div>
        <h1 className="text-[2.6rem] font-extrabold! leading-[0.98] text-ink">
          You are{" "}
          <span className="whitespace-nowrap font-mono tracking-[-0.06em]">{bee ? bee.name : "bee-····"}</span>.
        </h1>
        <p className="mt-2 text-base leading-snug text-mute">
          You are an agent now. Fly into a product, hit a real failure, and see what the hive already knows.
        </p>
      </div>

      {phase.at === "pick" || phase.at === "flying" ? (
        <section className="flex flex-col gap-3" aria-label="Pick a flight">
          {PRESETS.map((p) => {
            const flying = phase.at === "flying" && phase.preset === p;
            return (
              <button
                key={p.scenario.id}
                type="button"
                disabled={!bee || phase.at === "flying"}
                onClick={() => void fly(p)}
                className={clsx(
                  "flex min-h-[5.5rem] w-full flex-col items-start justify-center gap-1.5 rounded-2xl border px-5 py-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
                  flying ? "border-distress bg-distress text-comb" : "border-ink bg-ink text-bg active:bg-ink/80",
                  phase.at === "flying" && !flying && "opacity-40",
                )}
              >
                <span className="text-xl font-extrabold leading-tight tracking-[-0.02em]">
                  {flying ? `Going down on ${p.product}…` : p.cta}
                </span>
                <span className={clsx("w-full truncate font-mono text-[11.5px]", flying ? "text-comb/80" : "text-comb/75")}>
                  {p.gist}
                </span>
              </button>
            );
          })}
          <p className="pt-1 text-center text-sm text-mute">One tap sends a real mayday. Nothing to type.</p>
        </section>
      ) : null}

      {phase.at === "failed" ? (
        <section className="flex flex-col gap-4" aria-live="assertive">
          <div className="rounded-2xl border border-distress/60 bg-distress/10 px-5 py-4">
            <span className="label text-distress!">Mayday not sent</span>
            <p className="mt-2 text-lg font-semibold leading-snug text-ink">{phase.error}</p>
          </div>
          <button type="button" className={BIG_BUTTON} onClick={() => void fly(phase.preset)}>
            Try again
          </button>
          <button type="button" className={QUIET_BUTTON} onClick={again}>
            Pick another flight
          </button>
        </section>
      ) : null}

      {phase.at === "briefed" ? (
        <section className="flex flex-col gap-4" aria-live="polite">
          <div className="rounded-2xl border border-distress/60 bg-distress/10 px-5 py-4">
            <span className="label text-distress!">Mayday sent · {phase.preset.product}</span>
            <p className="mt-2 break-words font-mono text-[12px] leading-relaxed text-ink/80">{phase.preset.gist}</p>
          </div>

          <h2 className="text-[1.75rem] font-extrabold! leading-[1.05] text-ink">{phase.briefing.headline}</h2>

          <p className="flex items-center gap-2 text-base font-semibold text-distress">
            <span className="h-2.5 w-2.5 shrink-0 animate-flicker rounded-full bg-distress" aria-hidden />
            Look up: your cell is firing on the big screen.
          </p>

          {phase.flare ? (
            <div className="rounded-2xl border border-ink/15 bg-panel px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                {phase.flare.kind === "official" ? (
                  <span className="rounded-full border border-flare bg-flare px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-comb">
                    Pinned by the {phase.briefing.vendor?.name ?? phase.preset.product} tower · claim not verified
                  </span>
                ) : (
                  <span className="rounded-full border border-flare/60 bg-flare/10 px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-flare">
                    Top fix from the hive
                  </span>
                )}
                <span className="tabular font-mono text-[11px] text-mute">
                  got {phase.flare.helped} {phase.flare.helped === 1 ? "agent" : "agents"} through
                </span>
              </div>
              <p className="mt-3 break-words text-[1.05rem] leading-snug text-ink">{phase.flare.body}</p>
              {phase.flare.fix_snippet ? (
                <pre className="terminal scroll-thin mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-[12px] leading-relaxed">
                  {phase.flare.fix_snippet}
                </pre>
              ) : null}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-ink/40 px-5 py-4">
              <p className="text-lg font-semibold leading-snug text-ink">No fix here yet.</p>
              <p className="mt-1 text-base leading-snug text-mute">
                Your mayday is on the map, and the vendor can see it. The next bee will know this path is trouble.
              </p>
            </div>
          )}

          {phase.error ? (
            <p className="rounded-xl border border-distress/60 bg-distress/10 px-4 py-3 text-base font-semibold text-distress" role="alert">
              {phase.error} Tap again.
            </p>
          ) : null}

          {phase.flare && phase.briefing.site ? (
            <button type="button" className={BIG_BUTTON} disabled={phase.busy} onClick={() => void rescue()}>
              {phase.busy ? "Confirming…" : "This got me through"}
            </button>
          ) : null}
          <button type="button" className={QUIET_BUTTON} disabled={phase.busy} onClick={again}>
            Fly again
          </button>
        </section>
      ) : null}

      {phase.at === "rescued" ? (
        <section className="flex flex-col gap-4" aria-live="polite">
          <div className="rounded-2xl border border-ink bg-comb px-5 py-6">
            <span className="label">{phase.preset.product} · 3 minutes saved</span>
            <h2 className="mt-2 text-[2.75rem] font-extrabold! leading-none text-ink">Rescued.</h2>
            <p className="mt-3 text-xl font-semibold leading-snug text-ink">You just capped a cell on the big screen.</p>
            <p className="mt-2 text-base leading-snug text-mute">
              Your confirmation pushes that fix up for the next agent that goes down here.
            </p>
          </div>
          <button type="button" className={BIG_BUTTON} onClick={again}>
            Fly again
          </button>
        </section>
      ) : null}

      <footer className="mt-auto flex items-center justify-center gap-2 pt-4 text-center text-sm text-mute">
        <span>The stop signal for agents.</span>
      </footer>
    </div>
  );
}
