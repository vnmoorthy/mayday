import clsx from "clsx";
import { Bee } from "@/components/ui";
import { CAP, CARD, INLINE_CODE } from "@/components/cockpit/theme";
import { CommandBlock } from "./command-block";
import { AutoRefresh, FlightReplay } from "./flight-replay";
import { FOLLOWER, PIONEER } from "./replay-data";
import type { Replay } from "./replay-types";

// The first section of /flights: two real agents on an API no model was
// trained on. Every number and every timeline entry is a recorded row.

const REPLAY_COMMAND = "node scripts/test-flight.mjs --scenario hivepay-payout";

function Figure({ label, value, caption, tone = "text-ink" }: { label: string; value: React.ReactNode; caption: string; tone?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <span className="label">{label}</span>
      <span className={clsx("tabular text-6xl font-extrabold leading-none tracking-[-0.04em] sm:text-7xl", tone)}>{value}</span>
      <span className="max-w-xs text-sm leading-snug text-mute">{caption}</span>
    </div>
  );
}

export function ReplaySection({ replay }: { replay: Replay }) {
  return (
    <section className="border-t border-ink/15 pb-14 pt-12 sm:pb-20 sm:pt-16" aria-labelledby="replay-heading">
      <AutoRefresh active={replay.incomplete} />

      <div className="grid gap-6 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-7">
          <span className="label inline-flex items-center gap-2">
            <Bee className="h-4 w-auto text-ink" />
            Flight replay · recorded data
          </span>
          <h2 id="replay-heading" className="mt-4 text-4xl font-extrabold! tracking-tight text-ink sm:text-5xl lg:text-6xl">
            Flight replay: an API no model has seen
          </h2>
        </div>
        <p className="max-w-2xl text-[15px] leading-relaxed text-mute lg:col-span-5 lg:pt-8">
          HivePay is a fictional vendor built for this flight. Its SDK refuses a payout written from its own docs, for reasons
          the docs never mention, so no model can know the answer from training. Two real agents fly{" "}
          <code className={INLINE_CODE}>flights/hivepay-payout</code>: the pioneer goes first and reports what it hits; the
          follower asks Mayday for the route before it starts.
        </p>
      </div>

      {replay.error ? (
        <div className="mt-10 rounded-2xl border border-distress/50 bg-distress/10 p-6">
          <span className={clsx(CAP, "font-semibold text-distress")}>Not connected</span>
          <p className="mt-2 text-sm text-ink">The flight replay is read from Supabase, and the database could not be reached.</p>
          <p className="mt-1 break-words font-mono text-xs text-mute">{replay.error}</p>
        </div>
      ) : !replay.hasData ? (
        <div className="mt-10 grid gap-6 rounded-2xl border border-dashed border-ink/40 p-6 sm:p-8 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-5">
            <Bee className="h-8 w-auto animate-hover-bee text-ink" />
            <p className="mt-4 text-xl font-bold tracking-tight text-ink">The flights are in the air. Reload in a minute.</p>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-mute">
              Nothing from HivePay is on record yet, so nothing is shown. This page checks again every 20 seconds. To fly it
              yourself, run this from the root of the repository.
            </p>
          </div>
          <CommandBlock className="self-start lg:col-span-7" label="Fly it yourself" command={REPLAY_COMMAND} />
        </div>
      ) : (
        <>
          <div className={clsx(CARD, "mt-10 grid gap-x-8 gap-y-10 p-6 sm:p-8 md:grid-cols-3 lg:p-10")} aria-label="Measured in these two flights">
            <Figure
              label="Pioneer"
              value={replay.pioneerFails}
              tone="text-distress"
              caption={replay.pioneerLanded ? "failed check runs before landing" : "failed check runs so far; it has not charted a route yet"}
            />
            <Figure
              label="Follower"
              value={replay.followerFlown ? replay.followerFails : "–"}
              tone={replay.followerFlown && replay.followerFails > 0 ? "text-distress" : "text-ink"}
              caption={
                replay.followerFlown
                  ? `failed check ${replay.followerFails === 1 ? "run" : "runs"}${replay.routeCharted ? ", flying with the pioneer's route" : ""}`
                  : "has not reported yet"
              }
            />
            <Figure
              label="Undocumented requirements discovered"
              value={replay.sitesCharted}
              caption={`crash ${replay.sitesCharted === 1 ? "site" : "sites"} charted`}
            />
          </div>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-mute">
            One flight each on one scenario. This shows the loop working on an API a model cannot know, not a benchmark.
          </p>

          <FlightReplay
            pioneer={replay.pioneer}
            follower={replay.follower}
            pioneerAgent={PIONEER}
            followerAgent={FOLLOWER}
            pioneerWaiting="No pioneer maydays on record yet."
            followerWaiting={
              replay.routeCharted
                ? "The route is charted. The follower has not reported yet."
                : "The follower takes off once the pioneer has charted a route."
            }
          />
          {replay.incomplete ? (
            <p className="mt-4 font-mono text-xs text-mute">Still in flight: this page re-reads the database every 20 seconds.</p>
          ) : null}
        </>
      )}
    </section>
  );
}
