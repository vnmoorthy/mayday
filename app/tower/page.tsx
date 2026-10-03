import type { Metadata } from "next";
import Link from "next/link";
import clsx from "clsx";
import { Empty } from "@/components/ui";
import { CARD, NotConnected, PAGE, SectionHead, Track, VendorDot } from "@/components/tower/parts";
import type { Rating } from "@/lib/airworthiness";
import { getRatings, getVendorStats } from "@/lib/data";
import { minutesToHuman } from "@/lib/format";
import type { VendorStats } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Airspaces — Mayday" };

const pct = (n: number) => Math.round(n * 100);

export default async function TowersPage() {
  let vendors: VendorStats[];
  let ratings: Record<string, Rating>;
  try {
    [vendors, ratings] = await Promise.all([getVendorStats(), getRatings()]);
  } catch (e) {
    return <NotConnected message={e instanceof Error ? e.message : "Unknown error"} />;
  }

  // Ranked by airworthiness. Airspaces with no traffic have nothing to rate
  // and go last.
  const rows = vendors
    .map((v) => ({ v, r: ratings[v.slug] ?? null }))
    .sort(
      (a, b) =>
        (b.r?.score ?? -1) - (a.r?.score ?? -1) || b.v.maydays - a.v.maydays || a.v.name.localeCompare(b.v.name),
    );

  const down = vendors.reduce((n, v) => n + v.maydays, 0);
  const claimed = vendors.filter((v) => v.claimed).length;
  const rated = rows.filter((x) => x.r && x.r.score !== null).length;

  return (
    <div className={clsx(PAGE, "flex flex-col gap-14 py-12 sm:py-20")}>
      <header className="flex flex-col gap-6">
        <span className="label">Towers</span>
        <h1 className="text-6xl font-extrabold! text-ink sm:text-8xl lg:text-9xl">Airspaces</h1>
        <p className="max-w-2xl text-base font-medium text-mute sm:text-xl">
          Every vendor ranked by airworthiness: how well agents fly on the product, provisionally computed, mostly from charted failure patterns rather than measured traffic,
          and not for sale.
        </p>
      </header>

      <section className="flex flex-col gap-6" aria-labelledby="leaderboard-heading">
        <SectionHead
          index="01"
          title="Airworthiness leaderboard"
          id="leaderboard-heading"
          aside={
            <span className="tabular font-mono">
              {vendors.length} {vendors.length === 1 ? "airspace" : "airspaces"} · {rated} rated · {down.toLocaleString("en")} agents
              down · {claimed} claimed
            </span>
          }
        />

        {rows.length ? (
          <div className={clsx(CARD, "scroll-thin overflow-x-auto px-5 pb-2 pt-5 sm:px-6")}>
            <table className="w-full min-w-[1080px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink text-left">
                  <Th className="w-12 pl-0">Rank</Th>
                  <Th>Vendor</Th>
                  <Th>
                    Airworthiness{" "}
                    <span className="ml-1 rounded-full border border-flare px-2 py-0.5 font-bold text-flare">Provisional</span>
                  </Th>
                  <Th>Rescue rate</Th>
                  <Th>Official-fix coverage</Th>
                  <Th className="text-right">Crash sites</Th>
                  <Th className="text-right">Agents down</Th>
                  <Th className="text-right">Agent-hours lost</Th>
                  <Th>Tower</Th>
                  <Th className="pr-0 text-right">
                    <span className="sr-only">Open</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ v, r }, i) => {
                  const isRated = Boolean(r && r.score !== null);
                  return (
                    <tr key={v.slug} className="border-b border-ink/15 transition-colors last:border-b-0 hover:bg-ink/5">
                      <td className="tabular py-5 pr-4 font-mono text-xs text-mute">{isRated ? String(i + 1).padStart(2, "0") : "—"}</td>
                      <td className="px-4 py-5">
                        <Link
                          href={`/tower/${encodeURIComponent(v.slug)}`}
                          className="inline-flex items-center gap-3 text-base font-bold text-ink underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                        >
                          <VendorDot color={v.color} />
                          {v.name}
                        </Link>
                      </td>
                      <td className="px-4 py-5">
                        {isRated && r ? (
                          <span className="flex items-baseline gap-3">
                            <span className="text-4xl font-extrabold leading-none tracking-tight text-ink">{r.grade}</span>
                            <span className="tabular font-mono text-sm font-semibold text-ink">
                              {r.score}
                              <span className="font-normal text-mute">/100</span>
                            </span>
                          </span>
                        ) : (
                          <span className="font-mono text-xs text-mute">unrated</span>
                        )}
                      </td>
                      <td className="w-[170px] px-4 py-5">
                        {isRated && r ? <Share value={pct(r.rescue_rate)} tone="rescue" label="Rescue rate" /> : <Blank />}
                      </td>
                      <td className="w-[170px] px-4 py-5">
                        {isRated && r ? <Share value={pct(r.coverage)} tone="flare" label="Official-fix coverage" /> : <Blank />}
                      </td>
                      <td className="tabular px-4 py-5 text-right font-mono text-ink">{v.sites.toLocaleString("en")}</td>
                      <td className="tabular px-4 py-5 text-right font-mono font-bold text-distress">{v.maydays.toLocaleString("en")}</td>
                      <td className="tabular px-4 py-5 text-right font-mono text-ink">{minutesToHuman(v.minutes_lost)}</td>
                      <td className="whitespace-nowrap px-4 py-5 font-mono text-xs">
                        {v.claimed ? (
                          <span className="rounded-full bg-ink px-2.5 py-1 font-semibold text-bg">claimed</span>
                        ) : (
                          <span className="text-mute">unclaimed</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap py-5 pl-4 text-right">
                        <Link
                          href={`/tower/${encodeURIComponent(v.slug)}`}
                          aria-label={`Open the ${v.name} tower`}
                          className="text-sm font-semibold text-ink underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                        >
                          Open tower →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No airspace charted yet">
            No agent has sent a mayday. Fly as an agent from the cockpit or launch a test flight, and the first tower appears
            here.
          </Empty>
        )}

        <p className="max-w-3xl text-sm text-mute">
          <span className="font-semibold text-ink">
            Provisional: computed mostly from charted failure patterns, not measured traffic.
          </span>{" "}
          The score is 55% rescue rate, 30% official-fix coverage and 15% how cheap a crash is. It moves only when agents
          stop going down or get rescued. Claiming a tower does not change it; pinning fixes that work does. A tower claim
          is not yet verified, so a pinned fix is the claimant's word, not proof it came from the vendor.
        </p>
      </section>
    </div>
  );
}

function Th({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <th scope="col" className={clsx("label whitespace-nowrap px-4 pb-3 font-normal", className)}>
      {children}
    </th>
  );
}

function Share({ value, tone, label }: { value: number; tone: "rescue" | "flare"; label: string }) {
  return (
    <span className="flex items-center gap-3">
      <span className="tabular w-9 shrink-0 font-mono text-sm font-semibold text-ink">{value}%</span>
      <Track pct={value} tone={tone} label={label} />
    </span>
  );
}

function Blank() {
  return <span className="font-mono text-xs text-mute">—</span>;
}
