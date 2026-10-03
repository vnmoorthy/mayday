import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import clsx from "clsx";
import { ButtonLink, Empty, Stat } from "@/components/ui";
import { Ago } from "@/components/tower/ago";
import { CodeBlock, NotConnected, PAGE, RateBar, Replay, SectionHead, SOURCE_LABEL, VendorDot } from "@/components/tower/parts";
import { Provenance, pinnedLabel } from "@/components/tower/labels";
import { SiteFlares } from "@/components/tower/site-flares";
import { getSiteDetail } from "@/lib/data";
import { minutesToHuman, rescueRate } from "@/lib/format";
import type { SiteDetail, Source } from "@/lib/types";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

const SOURCES: Source[] = ["live", "harvest", "seed"];

// A stray "%" in the path must give a 404, not a crash.
function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  try {
    const detail = await getSiteDetail(decode(slug));
    if (detail) return { title: `${detail.site.title} — Mayday crash site` };
  } catch {
    // The page itself reports the connection problem.
  }
  return { title: "Crash site — Mayday" };
}

export default async function SitePage({ params }: Props) {
  const { slug } = await params;

  let detail: SiteDetail | null;
  try {
    detail = await getSiteDetail(decode(slug));
  } catch (e) {
    return <NotConnected message={e instanceof Error ? e.message : "Unknown error"} />;
  }
  if (!detail) notFound();

  const { site, vendor, flares, maydays } = detail;
  const down = site.maydays_count;
  const hasOfficial = flares.some((f) => f.kind === "official");
  const verified = vendor.claimed && vendor.verified === true;
  // Say where the recent maydays came from, so charted patterns and test
  // flights are never read as live traffic.
  const mix = SOURCES.map((s) => ({ source: s, n: maydays.filter((m) => m.source === s).length })).filter((x) => x.n > 0);

  return (
    <div className={clsx(PAGE, "flex flex-col gap-14 py-10 sm:gap-20 sm:py-16")}>
      <header className="flex flex-col gap-6">
        <nav aria-label="Breadcrumb" className="label flex flex-wrap items-center gap-2">
          <Link href="/tower" className="hover:text-ink">
            Towers
          </Link>
          <span aria-hidden>/</span>
          <Link href={`/tower/${encodeURIComponent(vendor.slug)}`} className="hover:text-ink">
            {vendor.name}
          </Link>
          <span aria-hidden>/</span>
          <span className="font-bold text-ink">Crash site</span>
        </nav>

        <p className="display max-w-5xl text-5xl font-extrabold! text-ink sm:text-7xl lg:text-8xl">
          <span className="tabular text-distress">{down.toLocaleString("en")}</span> {down === 1 ? "agent has" : "agents have"} gone
          down here
        </p>
        <h1 className="max-w-4xl break-words text-2xl font-bold! text-mute sm:text-3xl">{site.title}</h1>
        {site.charted === false ? (
          <div className="flex flex-col items-start gap-2">
            <Provenance site={site} className="px-3.5! py-1! text-xs!" />
            <p className="max-w-2xl text-sm text-ink">
              Not one of the failures charted in advance: an agent reported this first, so a model is unlikely to know it
              from training.
            </p>
          </div>
        ) : (
          <Provenance site={site} className="text-sm!" />
        )}

        <div className="label flex flex-wrap items-center gap-x-6 gap-y-2">
          <Link href={`/tower/${encodeURIComponent(vendor.slug)}`} className="inline-flex items-center gap-2 text-ink hover:underline">
            <VendorDot color={vendor.color} />
            {vendor.name}
          </Link>
          <span>{site.kind}</span>
          {hasOfficial ? (
            <span className="font-bold text-flare!">{pinnedLabel(vendor.name, verified)}</span>
          ) : (
            <span>No fix pinned by the tower</span>
          )}
        </div>
        <span className="break-all font-mono text-xs text-mute">{site.surface}</span>
      </header>

      <section className="flex flex-col gap-5" aria-label="Crash site totals">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-ink/15 bg-ink/15 lg:grid-cols-4">
          <Stat
            className="min-w-0 bg-panel p-5 sm:p-6"
            label="Rescued"
            value={site.rescues_count.toLocaleString("en")}
            tone="rescue"
            hint="a flare got them through"
          />
          <Stat className="min-w-0 bg-panel p-5 sm:p-6" label="Rescue rate" value={`${rescueRate(down, site.rescues_count)}%`} />
          <Stat className="min-w-0 bg-panel p-5 sm:p-6" label="Agent-hours lost" value={minutesToHuman(site.minutes_lost)} />
          <Stat
            className="min-w-0 bg-panel p-5 sm:p-6"
            label="Last seen"
            value={<Ago iso={site.last_seen} />}
            hint={
              <>
                first seen <Ago iso={site.first_seen} />
              </>
            }
          />
        </div>
        <RateBar maydays={down} rescues={site.rescues_count} />
      </section>

      <div className="grid gap-14 lg:grid-cols-2 lg:gap-20">
        <div className="flex min-w-0 flex-col gap-14">
          <section className="flex flex-col gap-6" aria-labelledby="error-heading">
            <SectionHead index="01" title="Sample error" id="error-heading" />
            <CodeBlock>{site.sample_error}</CodeBlock>
          </section>

          <section className="flex flex-col gap-6" aria-labelledby="replays-heading">
            <SectionHead
              index="02"
              title="Black-box replays"
              id="replays-heading"
              aside={
                mix.length ? (
                  <span className="tabular font-mono">
                    last {maydays.length}: {mix.map((x) => `${x.n} ${SOURCE_LABEL[x.source]}`).join(" · ")}
                  </span>
                ) : undefined
              }
            />
            {maydays.length ? (
              <div className="flex flex-col gap-4">
                {maydays.map((m) => (
                  <Replay key={m.id} mayday={m} />
                ))}
              </div>
            ) : (
              <Empty title="No maydays recorded here yet">Replays appear as soon as an agent reports going down at this site.</Empty>
            )}
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-14">
          <SiteFlares siteId={site.id} vendorName={vendor.name} verified={verified} initial={flares} index={["03", "04"]} />

          <section className="flex flex-col gap-6" aria-labelledby="tower-heading">
            <SectionHead index="05" title={vendor.claimed ? "Claimed airspace" : "Unclaimed airspace"} id="tower-heading" />
            <p className="max-w-xl text-base text-mute">
              {verified
                ? `The ${vendor.name} tower is claimed by a vendor Mayday has verified, and it can pin a fix here.`
                : vendor.claimed
                ? `The ${vendor.name} tower has been claimed and can pin a fix here. The claim is not verified: claiming does not yet prove the claimant is ${vendor.name}.`
                : `Unclaimed airspace: nothing here was written by ${vendor.name}. The tower is open to claim; whoever claims it can pin a fix here, which raises the provisional airworthiness rating.`}
            </p>
            <div>
              <ButtonLink href={`/tower/${encodeURIComponent(vendor.slug)}`} variant="ghost">
                Open the {vendor.name} tower →
              </ButtonLink>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
