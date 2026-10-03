"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, Copy, Pin, X } from "lucide-react";
import { Badge, ButtonLink, Empty, Stat } from "@/components/ui";
import { rate, type Rating } from "@/lib/airworthiness";
import { minutesToHuman, rescueRate } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { Flare, Incident, StopSignal, Rescue, Site, Vendor } from "@/lib/types";
import { Ago } from "./ago";
import { BillingPanel, useBilling } from "./billing-panel";
import { ClaimPanel } from "./claim-panel";
import { Incidents } from "./incidents";
import { WildChip, isWild, pinnedLabel } from "./labels";
import { CARD, Meter, Notice, PAGE, RateBar, SectionHead, VendorDot } from "./parts";
import { SiteDrawer } from "./site-drawer";

type SortKey = "down" | "rate" | "hours";
type Sort = { key: SortKey; dir: "desc" | "asc" };
type Live = "connecting" | "live" | "off" | "error";
type NoticeState = { tone: "radar" | "flare"; text: string } | null;

const HOT_MS = 4500;

const sortValue = (s: Site, key: SortKey) =>
  key === "down" ? s.maydays_count : key === "hours" ? s.minutes_lost : rescueRate(s.maydays_count, s.rescues_count);

// Realtime rows arrive as raw Postgres values; numerics can be strings.
const normalizeSite = (s: Site): Site => ({ ...s, minutes_lost: Number(s.minutes_lost) || 0 });

const pct = (n: number) => Math.round(n * 100);

export function TowerClient({
  vendor: initialVendor,
  sites: initialSites,
  officialSiteIds,
  rating: serverRating,
  origin,
  justClaimed,
}: {
  vendor: Vendor;
  sites: Site[];
  officialSiteIds: string[];
  rating: Rating | null;
  origin: string;
  justClaimed: boolean;
}) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const slug = initialVendor.slug;

  const [vendor, setVendor] = useState(initialVendor);
  const [sites, setSites] = useState(initialSites);
  const [official, setOfficial] = useState(() => new Set(officialSiteIds));
  const [sort, setSort] = useState<Sort>({ key: "down", dir: "desc" });
  const [selected, setSelected] = useState<string | null>(null);
  // Show only the crash sites an agent reported first (not charted in advance).
  const [wildOnly, setWildOnly] = useState(false);
  const [hot, setHot] = useState<Record<string, true>>({});
  const [live, setLive] = useState<Live>(() =>
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "connecting" : "off",
  );
  const [billingTick, setBillingTick] = useState(0);
  const [detailTick, setDetailTick] = useState(0);
  const [notice, setNotice] = useState<NoticeState>(
    justClaimed
      ? { tone: "radar", text: `Airspace claimed. The ${initialVendor.name} tower is open: pin official fixes at your crash sites.` }
      : null,
  );

  const billing = useBilling(slug, billingTick);
  const rateCents = billing.state.status === "ready" ? billing.state.data.rate_cents : null;

  // The realtime handlers live for the whole page, so they read current
  // values through refs instead of re-subscribing on every change.
  const siteIds = useRef(new Set(initialSites.map((s) => s.id)));
  const selectedRef = useRef<string | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => {
    siteIds.current = new Set(sites.map((s) => s.id));
  }, [sites]);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const flash = useCallback((siteId: string) => {
    setHot((prev) => ({ ...prev, [siteId]: true }));
    clearTimeout(timers.current[siteId]);
    timers.current[siteId] = setTimeout(() => {
      setHot((prev) => {
        const next = { ...prev };
        delete next[siteId];
        return next;
      });
    }, HOT_MS);
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => Object.values(pending).forEach(clearTimeout);
  }, []);


  useEffect(() => {
    const sb = supabaseBrowser();
    if (!sb) return;
    const channel = sb
      .channel(`tower:${slug}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "maydays" }, (p) => {
        const m = p.new as StopSignal;
        if (!siteIds.current.has(m.site_id)) return;
        flash(m.site_id);
        if (selectedRef.current === m.site_id) setDetailTick((n) => n + 1);
      })
      // INSERT is the rescue itself; UPDATE is Stripe marking it billed.
      .on("postgres_changes", { event: "*", schema: "public", table: "rescues" }, (p) => {
        if (p.eventType === "DELETE") return;
        const r = p.new as Rescue;
        if (!siteIds.current.has(r.site_id)) return;
        setBillingTick((n) => n + 1);
        if (p.eventType === "INSERT" && selectedRef.current === r.site_id) setDetailTick((n) => n + 1);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "flares" }, (p) => {
        const f = p.new as Flare;
        if (!siteIds.current.has(f.site_id)) return;
        if (f.kind === "official") setOfficial((prev) => new Set(prev).add(f.site_id));
        if (selectedRef.current === f.site_id) setDetailTick((n) => n + 1);
      })
      // Counters come from the site row, which the stop-signal and rescue
      // functions update in the same transaction as the insert.
      .on("postgres_changes", { event: "*", schema: "public", table: "sites", filter: `vendor=eq.${slug}` }, (p) => {
        if (p.eventType === "DELETE") return;
        const s = normalizeSite(p.new as Site);
        siteIds.current.add(s.id);
        setSites((prev) => (prev.some((x) => x.id === s.id) ? prev.map((x) => (x.id === s.id ? { ...x, ...s } : x)) : [s, ...prev]));
        if (p.eventType === "INSERT") {
          flash(s.id);
          // A first stop signal at a new site arrives before the site is known here.
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "vendors", filter: `slug=eq.${slug}` }, (p) => {
        setVendor((prev) => ({ ...prev, ...(p.new as Vendor) }));
        setBillingTick((n) => n + 1);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setLive("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setLive("error");
        else if (status === "CLOSED") setLive("off");
      });
    return () => {
      void sb.removeChannel(channel);
    };
  }, [slug, flash]);

  const totals = useMemo(() => {
    const down = sites.reduce((n, s) => n + s.maydays_count, 0);
    const rescued = sites.reduce((n, s) => n + s.rescues_count, 0);
    const minutes = sites.reduce((n, s) => n + s.minutes_lost, 0);
    return { down, rescued, minutes, rate: rescueRate(down, rescued) };
  }, [sites]);

  // The rating the server computed is shown until something moves on this
  // page (a stop signal, a rescue, a pinned fix). After that it is recomputed with
  // the same pure function, so the grade follows the table in real time.
  const rating = useMemo<Rating>(() => {
    if (serverRating && sites === initialSites && official.size === officialSiteIds.length) return serverRating;
    const covered = sites.filter((s) => official.has(s.id));
    return rate({
      sites: sites.length,
      maydays: sites.reduce((n, s) => n + s.maydays_count, 0),
      rescues: sites.reduce((n, s) => n + s.rescues_count, 0),
      minutes_lost: sites.reduce((n, s) => n + s.minutes_lost, 0),
      covered_sites: covered.length,
      covered_maydays: covered.reduce((n, s) => n + s.maydays_count, 0),
    });
  }, [serverRating, sites, initialSites, official, officialSiteIds]);

  const sorted = useMemo(() => {
    const dir = sort.dir === "desc" ? -1 : 1;
    return [...(wildOnly ? sites.filter(isWild) : sites)].sort(
      (a, b) => dir * (sortValue(a, sort.key) - sortValue(b, sort.key)) || b.maydays_count - a.maydays_count || a.title.localeCompare(b.title),
    );
  }, [sites, sort, wildOnly]);

  const wildCount = useMemo(() => sites.filter(isWild).length, [sites]);
  const pinnedSites = useMemo(
    () => sites.filter((s) => official.has(s.id)).sort((a, b) => b.maydays_count - a.maydays_count || a.title.localeCompare(b.title)),
    [sites, official],
  );
  const verified = vendor.claimed && vendor.verified === true;

  const selectedSite = selected ? (sites.find((s) => s.id === selected) ?? null) : null;
  const closeDrawer = useCallback(() => setSelected(null), []);

  // An incident opens its crash site's drawer. A site this page has not
  // loaded yet falls back to the public crash-site page.
  function openIncident(incident: Incident) {
    if (sites.some((s) => s.id === incident.site_id)) setSelected(incident.site_id);
    else router.push(`/site/${encodeURIComponent(incident.slug)}`);
  }

  const demoClaimed = useCallback(() => {
    setVendor((prev) => ({ ...prev, claimed: true, claimed_at: prev.claimed_at ?? new Date().toISOString() }));
    setNotice({
      tone: "flare",
      text: "Stripe is not configured on this deployment, so the airspace was claimed in demo mode. No payment was taken.",
    });
    setBillingTick((n) => n + 1);
    router.refresh();
  }, [router]);

  function dismissNotice() {
    setNotice(null);
    // Drop ?claimed=1 so a reload does not announce the claim again.
    if (justClaimed) router.replace(`/tower/${slug}`, { scroll: false });
  }

  function toggleSort(key: SortKey) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
  }

  const rated = rating.score !== null;
  const cheapness = rated ? 100 * (1 - Math.min(rating.avg_minutes_lost, 30) / 30) : 0;

  // Sections are numbered in the order they appear; the claim section only
  // exists while the airspace is unclaimed.
  let n = 0;
  const idx = () => String(++n).padStart(2, "0");

  // The sections below are rendered in a different order for claimed and
  // unclaimed towers. They are plain functions, called in render order, so
  // the section numbers follow the page.
  const renderOverview = () => (
    <>
      <section className="flex flex-col gap-6" aria-labelledby="airworthiness-heading">
        <SectionHead
          index={idx()}
          title="Airworthiness"
          id="airworthiness-heading"
          aside={
            <span className="inline-flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-flare px-2.5 py-0.5 font-mono text-xs font-bold uppercase tracking-[0.12em] text-flare">
                Provisional
              </span>
              It cannot be bought.
            </span>
          }
        />
        <div className={clsx(CARD, "flex flex-col gap-10 p-6 sm:p-10")}>
        <p className="max-w-3xl text-sm font-semibold text-ink">
          Provisional: computed mostly from charted failure patterns, not measured traffic.
        </p>
        <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
          <div className="flex items-end gap-6 sm:gap-8">
            <span
              className="display text-[10rem] font-extrabold! leading-[0.82]! text-ink sm:text-[15rem]"
              aria-label={rated ? `Provisional grade ${rating.grade}` : "Not rated"}
            >
              {rating.grade}
            </span>
            <div className="flex flex-col gap-2 pb-1 sm:pb-3">
              <span className="label">Provisional score</span>
              <span className="tabular text-5xl font-extrabold leading-none tracking-tight text-ink sm:text-7xl">
                {rated ? rating.score : "—"}
                <span className="text-xl font-semibold tracking-normal text-mute sm:text-2xl"> /100</span>
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-8">
            <Meter
              label="Rescue rate"
              value={rated ? `${pct(rating.rescue_rate)}%` : "—"}
              pct={pct(rating.rescue_rate)}
              tone="rescue"
              hint={`55% of the score. ${rating.rescues.toLocaleString("en")} of ${rating.maydays.toLocaleString("en")} agents that went down were rescued.`}
            />
            <Meter
              label="Official-fix coverage"
              value={rated ? `${pct(rating.coverage)}%` : "—"}
              pct={pct(rating.coverage)}
              tone="flare"
              hint={`30% of the score. ${rating.covered_sites.toLocaleString("en")} of ${rating.sites.toLocaleString("en")} crash sites have an official fix pinned.`}
            />
            <Meter
              label="Cost of a crash"
              value={rated ? `${rating.avg_minutes_lost.toFixed(1)} min` : "—"}
              pct={cheapness}
              tone="ink"
              hint="15% of the score. Agent-minutes lost per crash; a fuller bar is a cheaper crash, and 30 minutes or more scores nothing."
            />
            <p className="max-w-2xl text-base font-medium text-ink">{rating.summary}</p>
          </div>
        </div>
        <Readme origin={origin} slug={slug} name={vendor.name} />
        </div>
      </section>

      <section className="flex flex-col gap-6" aria-labelledby="traffic-heading">
        <SectionHead
          index={idx()}
          title="Traffic"
          id="traffic-heading"
          aside="Totals combine live stop signals, test flights and charted failure patterns. Every replay and flare is labelled with its source."
        />
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-ink/15 bg-ink/15 lg:grid-cols-4">
          <Stat
            className="min-w-0 bg-panel p-5 sm:p-6"
            label="Agents down"
            value={totals.down.toLocaleString("en")}
            tone="distress"
            hint={`across ${sites.length} crash ${sites.length === 1 ? "site" : "sites"}`}
          />
          <Stat
            className="min-w-0 bg-panel p-5 sm:p-6"
            label="Rescued"
            value={totals.rescued.toLocaleString("en")}
            tone="rescue"
            hint="a flare got them through"
          />
          <Stat
            className="min-w-0 bg-panel p-5 sm:p-6"
            label="Rescue rate"
            value={`${totals.rate}%`}
            hint="rescues per stop signal"
          />
          <Stat
            className="min-w-0 bg-panel p-5 sm:p-6"
            label="Agent-hours lost"
            value={minutesToHuman(totals.minutes)}
            hint="reported by agents that went down"
          />
        </div>
      </section>
    </>
  );

  const renderClaim = () => (
    <>
      {!vendor.claimed ? (
        <section className="flex flex-col gap-6" aria-label="Claim this airspace">
          <SectionHead index={idx()} title="Claim this airspace" />
          <ClaimPanel
            vendor={vendor}
            rateCents={rateCents}
            coveragePct={rated ? pct(rating.coverage) : null}
            grade={rated ? rating.grade : null}
            onDemoClaimed={demoClaimed}
          />
        </section>
      ) : null}
    </>
  );

  const renderSites = () => (
    <>
      <section className="flex min-w-0 flex-col gap-6" aria-labelledby="sites-heading">
        <SectionHead
          index={idx()}
          title="Crash sites"
          id="sites-heading"
          aside={
            <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-2">
              <button
                type="button"
                aria-pressed={wildOnly}
                onClick={() => setWildOnly((v) => !v)}
                title="Crash sites an agent reported first. They were not charted in advance, so a model is unlikely to know them from training."
                className={clsx(
                  "tabular rounded-full border border-ink px-3 py-1 font-mono text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
                  wildOnly ? "bg-ink text-bg" : "text-ink hover:bg-ink hover:text-bg",
                )}
              >
                In the wild only · {wildCount}
              </button>
              <span>Select a crash site to read its black box</span>
            </span>
          }
        />
        {sorted.length ? (
          <div className={clsx(CARD, "scroll-thin overflow-x-auto px-5 pb-2 pt-5 sm:px-6")}>
            <table className="w-full min-w-[960px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink text-left">
                  <Th className="pl-0">Crash site</Th>
                  <Th>Surface</Th>
                  <Th>Kind</Th>
                  <SortTh label="Agents down" k="down" sort={sort} onSort={toggleSort} />
                  <Th className="text-right">Rescued</Th>
                  <SortTh label="Rescue rate" k="rate" sort={sort} onSort={toggleSort} />
                  <SortTh label="Hours lost" k="hours" sort={sort} onSort={toggleSort} />
                  <Th>Last seen</Th>
                  <Th className="pr-0">Official fix</Th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => {
                  const isHot = Boolean(hot[s.id]);
                  const isSelected = s.id === selected;
                  return (
                    <motion.tr
                      key={s.id}
                      onClick={() => setSelected(s.id)}
                      initial={false}
                      animate={{ backgroundColor: isHot ? "rgba(184, 15, 38, 0.2)" : "rgba(184, 15, 38, 0)" }}
                      transition={{ duration: reduce ? 0 : isHot ? 0.15 : 1.2 }}
                      className={clsx(
                        "cursor-pointer border-b border-ink/15 last:border-b-0 [&:hover>td]:bg-ink/5",
                        isSelected && "[&>td]:bg-ink/10",
                      )}
                    >
                      <td className="max-w-[320px] py-4 pr-4">
                        <button
                          type="button"
                          aria-label={`Open crash site: ${s.title}`}
                          className="block w-full truncate text-left text-[15px] font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                          title={s.title}
                        >
                          {s.title}
                        </button>
                        {isWild(s) ? <WildChip firstSeen={s.first_seen} className="mt-1.5" /> : null}
                        {isHot ? (
                          <span className="mt-1.5 inline-flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-distress">
                            <span className="h-1.5 w-1.5 rounded-full bg-distress animate-flicker" aria-hidden />
                            signal just in
                          </span>
                        ) : null}
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-4 font-mono text-xs text-mute" title={s.surface}>
                        {s.surface}
                      </td>
                      <td className="px-4 py-4 font-mono text-xs text-mute">{s.kind}</td>
                      <td className="tabular px-4 py-4 text-right font-mono font-bold text-distress">{s.maydays_count.toLocaleString("en")}</td>
                      <td className="tabular px-4 py-4 text-right font-mono font-bold text-rescue">{s.rescues_count.toLocaleString("en")}</td>
                      <td className="w-[160px] px-4 py-4">
                        <RateBar maydays={s.maydays_count} rescues={s.rescues_count} />
                      </td>
                      <td className="tabular px-4 py-4 text-right font-mono text-ink">{minutesToHuman(s.minutes_lost)}</td>
                      <td className="whitespace-nowrap px-4 py-4 font-mono text-xs text-mute">
                        <Ago iso={s.last_seen} />
                      </td>
                      <td className="whitespace-nowrap py-4 pl-4">
                        {official.has(s.id) ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-flare/60 bg-flare/10 px-2.5 py-0.5 font-mono text-xs font-semibold text-flare">
                            <Pin className="h-3 w-3" strokeWidth={1.5} aria-hidden />
                            pinned
                          </span>
                        ) : (
                          <span className="font-mono text-xs text-mute">none</span>
                        )}
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          wildOnly && sites.length ? (
            <Empty title="No crash site here was first seen in the wild yet">
              Every crash site in this airspace was charted in advance from a known failure pattern. A site an agent reports
              first shows up here, marked with when it was first seen.
            </Empty>
          ) : (
            <Empty title="No crash sites charted in this airspace">
              No agent has reported going down on {vendor.name} yet. Launch a test flight to find crash sites before agents
              in the wild do.
            </Empty>
          )
        )}
      </section>
    </>
  );

  const renderPinned = () => (
    <>
      <section className="flex min-w-0 flex-col gap-6" aria-labelledby="pinned-heading">
        <SectionHead
          index={idx()}
          title="Pinned fixes"
          id="pinned-heading"
          aside={`${pinnedSites.length} of ${sites.length} crash ${sites.length === 1 ? "site" : "sites"} covered`}
        />
        {pinnedSites.length ? (
          <ul className={clsx(CARD, "flex flex-col px-5 sm:px-6")}>
            {pinnedSites.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-ink/15 py-4 last:border-b-0">
                <span className="min-w-0 flex-1 basis-64">
                  <span className="block break-words text-[15px] font-semibold text-ink">{s.title}</span>
                  <span className="label mt-1 block font-bold text-flare!">{pinnedLabel(vendor.name, verified)}</span>
                </span>
                <span className="tabular whitespace-nowrap font-mono text-xs text-mute">
                  <span className="font-bold text-distress">{s.maydays_count.toLocaleString("en")}</span> down ·{" "}
                  <span className="font-bold text-rescue">{s.rescues_count.toLocaleString("en")}</span> rescued
                </span>
                <button
                  type="button"
                  onClick={() => setSelected(s.id)}
                  className="whitespace-nowrap text-sm font-semibold text-ink underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                >
                  Open the fix →
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="No fix pinned yet">
            Select a crash site above and pin a fix there. Agents that go down at that site are handed the pinned fix first.
          </Empty>
        )}
      </section>
    </>
  );

  return (
    <div className={clsx(PAGE, "flex flex-col gap-14 py-10 sm:gap-20 sm:py-16")}>
      <header className="flex flex-col gap-6">
        <nav aria-label="Breadcrumb" className="label flex items-center gap-2">
          <Link href="/tower" className="hover:text-ink">
            Towers
          </Link>
          <span aria-hidden>/</span>
          <span className="font-bold text-ink">{vendor.name}</span>
        </nav>
        <h1 className="break-words text-6xl font-extrabold! text-ink sm:text-8xl lg:text-9xl">{vendor.name}</h1>
        <div className="label flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="inline-flex items-center gap-2">
            <VendorDot color={vendor.color} />
            Tower
          </span>
          {verified ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1 font-bold text-bg"
              title="Pioneer has verified this vendor. A paid claim alone does not earn this mark."
            >
              <Check className="h-3 w-3 shrink-0" strokeWidth={2.5} aria-hidden />
              Verified vendor{slug === "hivepay" ? " · Pioneer's own demo airspace" : ""}
            </span>
          ) : null}
          {vendor.claimed ? (
            <span className="text-ink">
              Claimed
              {vendor.claimed_at ? (
                <>
                  {" "}
                  <Ago iso={vendor.claimed_at} />
                </>
              ) : null}
              {verified ? "" : " · claim not verified"}
            </span>
          ) : (
            <span>Unclaimed airspace: nothing here was written by {vendor.name}.</span>
          )}
          <LiveStatus live={live} />
        </div>
      </header>

      {notice ? (
        <Notice
          tone={notice.tone}
          action={
            <button
              type="button"
              onClick={dismissNotice}
              aria-label="Dismiss"
              className="rounded-full p-1 text-ink transition-colors hover:bg-ink hover:text-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink"
            >
              <X className="h-4 w-4" strokeWidth={1.5} aria-hidden />
            </button>
          }
        >
          {notice.text}
        </Notice>
      ) : null}

      <Incidents index={idx()} slug={slug} onOpen={openIncident} />

      {/* A claimed tower is a working surface: crash sites and pinned fixes come
          straight after the incidents. An unclaimed one leads with the rating
          and the invitation to claim. */}
      {vendor.claimed ? (
        <>
          {renderSites()}
          {renderPinned()}
          {renderOverview()}
        </>
      ) : (
        <>
          {renderOverview()}
          {renderClaim()}
          {renderSites()}
        </>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className={clsx(CARD, "flex min-w-0 flex-col gap-6 p-6 sm:p-8")} aria-label="Billing">
          <BillingPanel
            index={idx()}
            state={billing.state}
            refreshing={billing.refreshing}
            claimed={vendor.claimed}
            onReload={billing.reload}
          />
        </section>
        <section className={clsx(CARD, "flex min-w-0 flex-col gap-6 p-6 sm:p-8")} aria-labelledby="flights-heading">
          <SectionHead index={idx()} title="Test flights" id="flights-heading" rule={false} />
          <p className="max-w-xl text-4xl font-extrabold leading-[1.05] tracking-tight text-ink sm:text-5xl">
            Send real agents at {vendor.name} on purpose.
          </p>
          <p className="max-w-xl text-base text-mute">
            Every place they go down is charted here before an agent in the wild finds it, and every fix you pin there counts
            toward coverage.
          </p>
          <div>
            <ButtonLink href="/flights" variant="ghost">
              Launch a test flight →
            </ButtonLink>
          </div>
        </section>
      </div>

      <AnimatePresence>
        {selectedSite ? (
          <SiteDrawer
            key={selectedSite.id}
            site={selectedSite}
            vendor={vendor}
            tick={detailTick}
            rateCents={rateCents}
            onClose={closeDrawer}
            onOfficialPinned={(id) => setOfficial((prev) => new Set(prev).add(id))}
            onDemoClaimed={demoClaimed}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

// The badge and the markdown that embeds it. Vendors put it in their README;
// it links back here, so the rating travels with the product.
function Readme({ origin, slug, name }: { origin: string; slug: string; name: string }) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const path = encodeURIComponent(slug);
  const snippet = `[![Pioneer airworthiness](${origin}/api/badge/${path})](${origin}/tower/${path})`;

  useEffect(() => {
    if (copied === "idle") return;
    const t = setTimeout(() => setCopied("idle"), 2400);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied("copied");
    } catch {
      // Clipboard access can be refused (insecure origin, permissions). The
      // snippet stays selectable so it can still be copied by hand.
      setCopied("failed");
    }
  }

  return (
    <div className="grid gap-5 border-t border-ink/15 pt-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
      <div className="flex flex-col items-start gap-4">
        <span className="label">Put it in your README</span>
        {/* A plain img: the badge is an SVG served by our own API. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/badge/${path}`} alt={`Pioneer airworthiness badge for ${name}`} className="h-5 max-w-full" />
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <div className="terminal flex min-w-0 items-center gap-2 p-1.5 pl-0">
          <code className="min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap px-5 py-2.5 font-mono text-xs text-comb [scrollbar-color:var(--color-dim)_transparent] [scrollbar-width:thin]">
            {snippet}
          </code>
          <button
            type="button"
            onClick={copy}
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-comb px-4 py-2 text-xs font-bold text-ink transition-colors hover:bg-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-comb"
          >
            {copied === "copied" ? <Check className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden /> : <Copy className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />}
            {copied === "copied" ? "Copied" : "Copy"}
          </button>
        </div>
        <span className="text-xs text-mute" role="status">
          {copied === "failed"
            ? "The browser refused clipboard access. Select the markdown and copy it by hand."
            : "Markdown. The badge always shows the current grade and links back to this tower."}
        </span>
      </div>
    </div>
  );
}

function LiveStatus({ live }: { live: Live }) {
  if (live === "live") {
    return (
      <span className="inline-flex items-center gap-2 text-ink" title="Subscribed to stop signals, rescues and flares over Supabase Realtime">
        <span className="h-2 w-2 rounded-full bg-ink animate-flicker" aria-hidden />
        Live
      </span>
    );
  }
  if (live === "connecting") return <span>Connecting</span>;
  if (live === "error") {
    return (
      <Badge tone="distress" title="The Realtime channel failed. Reload to see new stop signals.">
        realtime error
      </Badge>
    );
  }
  return <span title="Supabase Realtime is not connected. Reload the page to see new stop signals.">Realtime off</span>;
}

function Th({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <th scope="col" className={clsx("label whitespace-nowrap px-4 pb-3 font-normal", className)}>
      {children}
    </th>
  );
}

function SortTh({ label, k, sort, onSort }: { label: string; k: SortKey; sort: Sort; onSort: (k: SortKey) => void }) {
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.dir === "desc" ? ArrowDown : ArrowUp;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === "desc" ? "descending" : "ascending") : "none"}
      className="whitespace-nowrap px-4 pb-3 text-right font-normal"
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className={clsx(
          "label inline-flex items-center gap-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
          active ? "text-ink!" : "hover:text-ink!",
        )}
      >
        {label}
        <Icon className="h-3 w-3" strokeWidth={1.5} aria-hidden />
      </button>
    </th>
  );
}
