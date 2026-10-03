import type { Metadata } from "next";
import Link from "next/link";
import clsx from "clsx";
import { getRecentMaydays } from "@/lib/data";
import { timeAgo } from "@/lib/format";
import type { FeedSignal, StopSignal } from "@/lib/types";
import { Badge, Bee, Stat } from "@/components/ui";
import { CARD, CAP, FOCUS, H2, HEADLINE, INLINE_CODE } from "@/components/cockpit/theme";
import { CommandBlock } from "@/components/flights/command-block";
import { getFlightScenarios } from "@/components/flights/scenarios";
import { loadReplay } from "@/components/flights/replay-data";
import { ReplaySection } from "@/components/flights/replay-section";

// Reads scenarios from disk and stop signals from Postgres on every request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Test flights — Pioneer",
  description: "Real agent runs launched on purpose to find crash sites before agents in the wild do.",
};

// Outcome is data, so it is the one coloured cell in the table.
const OUTCOME: Record<StopSignal["outcome"], { label: string; chip: string }> = {
  down: { label: "Down", chip: "border-distress/60 bg-distress/10 text-distress" },
  rescued: { label: "Rescued", chip: "border-rescue/60 bg-rescue/10 text-rescue" },
  self_recovered: { label: "Self-recovered", chip: "border-ink/40 bg-ink/5 text-ink" },
};

const flightCommand = (scenario: string) => `node scripts/test-flight.mjs --scenario ${scenario}`;

function SectionHead({ id, index, title, children }: { id: string; index: string; title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-6 lg:grid-cols-12 lg:gap-10">
      <div className="lg:col-span-6">
        <span className="label">{index}</span>
        <h2 id={id} className={clsx("mt-4 text-4xl sm:text-5xl", H2)}>
          {title}
        </h2>
      </div>
      <p className="max-w-2xl text-[15px] leading-relaxed text-mute lg:col-span-6 lg:pt-8">{children}</p>
    </div>
  );
}

export default async function FlightsPage() {
  // loadReplay never throws: a database failure comes back as replay.error.
  const [{ scenarios, fromDisk }, replay] = await Promise.all([getFlightScenarios(), loadReplay()]);
  const first = scenarios[0]?.name ?? "stripe-webhook";

  // Test-flight stop signals are the ones logged with source "harvest".
  let flights: FeedSignal[] = [];
  let dbError: string | null = null;
  try {
    flights = (await getRecentMaydays(100)).filter((m) => m.source === "harvest");
  } catch (err) {
    dbError = err instanceof Error ? err.message : "Unknown error";
  }
  const rescued = flights.filter((m) => m.outcome !== "down").length;
  const sites = new Set(flights.map((m) => m.site_id)).size;

  return (
    <div className="mx-auto w-full max-w-[1440px] px-5 pb-16 sm:px-8">
      <header className="grid gap-8 py-14 sm:py-20 lg:grid-cols-12 lg:items-end">
        <div className="lg:col-span-8">
          <span className="label inline-flex items-center gap-2">
            <Bee className="h-4 w-auto text-ink" />
            Test flights
          </span>
          <h1 className={clsx("mt-5", HEADLINE)}>Crash on purpose, before agents in the wild do.</h1>
        </div>
        <div className="lg:col-span-4">
          <p className="text-[15px] leading-relaxed text-mute">
            A test flight drops a real coding agent into a small project that fails with a genuine SDK error, and records where
            it goes down. Each one leaves a stop signal at the crash site, labelled as a test flight, so the map is charted before
            live traffic arrives.
          </p>
        </div>
      </header>

      <ReplaySection replay={replay} />

      <section
        className={clsx(CARD, "grid grid-cols-2 gap-x-6 gap-y-10 p-6 sm:p-8 lg:grid-cols-4 lg:p-10")}
        aria-label="Test flight totals"
      >
        <Stat label="Scenarios" value={scenarios.length} hint={fromDisk ? "Read from flights/" : "Built-in list"} />
        <Stat label="Flight signals" value={dbError ? "–" : flights.length} tone="distress" hint="Among the last 100 stop signals" />
        <Stat label="Crash sites hit" value={dbError ? "–" : sites} />
        <Stat label="Got through" value={dbError ? "–" : rescued} tone="rescue" hint="Rescued or self-recovered" />
      </section>

      <section className="py-14 sm:py-20" aria-labelledby="scenarios-heading">
        <SectionHead id="scenarios-heading" index="01 — Scenarios" title="Traps with real errors.">
          Each scenario is a tiny project whose check fails offline with the real error from the installed SDK. The agent is
          told to make <code className={INLINE_CODE}>node check.mjs</code> pass without editing the check.
        </SectionHead>
        <ol className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {scenarios.map((s, i) => (
            <li key={s.name} className={clsx(CARD, "flex min-w-0 flex-col gap-5 p-6 sm:p-7")}>
              <div className="flex items-center justify-between gap-3">
                <span className="label tabular">Flight {String(i + 1).padStart(2, "0")}</span>
                <Badge tone="radar">{s.vendor}</Badge>
              </div>
              <div className="min-w-0">
                <h3 className="text-xl font-bold! leading-snug tracking-tight text-ink sm:text-2xl">{s.title}</h3>
                {s.surface ? <span className="mt-2 block break-all font-mono text-xs text-mute">{s.surface}</span> : null}
                {s.description ? <p className="mt-3 text-sm leading-relaxed text-mute">{s.description}</p> : null}
              </div>
              <CommandBlock className="mt-auto" label={`flights/${s.name}`} command={flightCommand(s.name)} />
            </li>
          ))}
        </ol>
      </section>

      <section className="border-t border-ink/15 py-14 sm:py-20" aria-labelledby="launch-heading">
        <SectionHead id="launch-heading" index="02 — Launch a flight" title="One command, from the repository root.">
          Flights run on your machine, from the root of the Pioneer repository, with the Claude Code CLI signed in. The script
          copies the scenario to a temporary directory, runs <code className={INLINE_CODE}>claude -p</code> headlessly with a
          four minute limit, then runs the check and reports to this server.
        </SectionHead>
        <div className="mt-10 grid gap-5 lg:grid-cols-2">
          <CommandBlock
            label="With the Pioneer plugin: the agent gets briefings"
            command={`${flightCommand(first)} --runs 3 --url http://localhost:3000`}
          />
          <CommandBlock
            label="Control run: no plugin, no briefings"
            command={`${flightCommand(first)} --runs 3 --no-mayday --url http://localhost:3000`}
          />
        </div>
        <p className="mt-5 max-w-3xl text-sm leading-relaxed text-mute">
          Pass <code className={INLINE_CODE}>--url</code> to report to another Pioneer server. With the plugin on, the hook
          reports each failed command as it happens; otherwise the flight leaves one summary stop signal.
        </p>
      </section>

      <section className="border-t border-ink/15 py-14 sm:py-20" aria-labelledby="results-heading">
        <SectionHead id="results-heading" index="03 — Results · source: harvest" title="Recent test-flight stop signals.">
          Stop signals logged by test flights. Live traffic and seeded sites are not shown here.
        </SectionHead>

        {dbError ? (
          <div className="mt-10 rounded-2xl border border-distress/50 bg-distress/10 p-6">
            <span className={clsx(CAP, "font-semibold text-distress")}>Not connected</span>
            <p className="mt-2 text-sm text-ink">Flight results are read from Supabase, and the database could not be reached.</p>
            <p className="mt-1 break-words font-mono text-xs text-mute">{dbError}</p>
          </div>
        ) : flights.length === 0 ? (
          <div className="mt-10 grid gap-6 rounded-2xl border border-dashed border-ink/40 p-6 sm:p-8 lg:grid-cols-12 lg:gap-10">
            <div className="lg:col-span-5">
              <Bee className="h-8 w-auto animate-hover-bee text-ink" />
              <p className="mt-4 text-xl font-bold tracking-tight text-ink">No test flights recorded yet.</p>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-mute">
                Nothing is shown because nothing has flown. Launch one from the root of the repository and its stop signal will
                appear here.
              </p>
            </div>
            <CommandBlock className="self-start lg:col-span-7" label="Launch the first flight" command={flightCommand(first)} />
          </div>
        ) : (
          <div className={clsx(CARD, "scroll-thin mt-10 overflow-x-auto")}>
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-ink/15 bg-ink/5">
                  <th scope="col" className="label px-5 py-3.5 font-normal sm:px-6">
                    Crash site
                  </th>
                  <th scope="col" className="label px-5 py-3.5 font-normal sm:px-6">
                    Agent
                  </th>
                  <th scope="col" className="label px-5 py-3.5 font-normal sm:px-6">
                    Outcome
                  </th>
                  <th scope="col" className="label px-5 py-3.5 text-right font-normal sm:px-6">
                    Time
                  </th>
                </tr>
              </thead>
              <tbody>
                {flights.map((m) => {
                  const outcome = OUTCOME[m.outcome] ?? OUTCOME.down;
                  return (
                    <tr key={m.id} className="border-b border-ink/15 align-top transition-colors last:border-b-0 hover:bg-ink/5">
                      <td className="px-5 py-4 sm:px-6">
                        <Link
                          href={`/site/${m.site.slug}`}
                          className={clsx(
                            "inline-block max-w-[440px] truncate align-bottom font-semibold text-ink underline-offset-4 hover:underline",
                            FOCUS,
                          )}
                        >
                          {m.site.title}
                        </Link>
                        <div className="mt-1 truncate font-mono text-xs text-mute">
                          {m.site.vendor} · {m.site.surface}
                        </div>
                      </td>
                      <td className="px-5 py-4 sm:px-6">
                        <span className="font-mono text-xs text-ink">{m.agent}</span>
                        {m.model ? <div className="mt-1 font-mono text-xs text-mute">{m.model}</div> : null}
                      </td>
                      <td className="px-5 py-4 sm:px-6">
                        <span
                          className={clsx(
                            "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.12em]",
                            outcome.chip,
                          )}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                          {outcome.label}
                        </span>
                      </td>
                      <td className="tabular whitespace-nowrap px-5 py-4 text-right font-mono text-xs text-mute sm:px-6">
                        <time dateTime={m.created_at}>{timeAgo(m.created_at)}</time>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
