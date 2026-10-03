"use client";

import Link from "next/link";
import clsx from "clsx";
import { useMemo, useState } from "react";
import type { AgentRow } from "@/lib/types";
import { minutesToHuman, rescueRate } from "@/lib/format";
import { Badge, Bee, ButtonLink, Stat } from "@/components/ui";

export type VendorRef = { slug: string; name: string; color: string };

type Agg = { key: string; maydays: number; rescued: number; minutes: number; sites: number; live: number };

const SEP = "\u0000";

// Roll rows up by any key. Distinct crash sites cannot be summed across models,
// so per vendor we keep the largest count we saw: a floor, never an overcount.
function aggregate(rows: AgentRow[], keyOf: (r: AgentRow) => string): Agg[] {
  const map = new Map<string, Agg & { siteBy: Map<string, number> }>();
  for (const r of rows) {
    const key = keyOf(r);
    let a = map.get(key);
    if (!a) {
      a = { key, maydays: 0, rescued: 0, minutes: 0, sites: 0, live: 0, siteBy: new Map() };
      map.set(key, a);
    }
    a.maydays += r.maydays;
    a.rescued += r.rescued;
    a.minutes += r.minutes_lost;
    a.live += r.live;
    a.siteBy.set(r.vendor, Math.max(a.siteBy.get(r.vendor) ?? 0, r.sites));
  }
  return [...map.values()].map(({ siteBy, ...a }) => ({ ...a, sites: [...siteBy.values()].reduce((x, y) => x + y, 0) }));
}

type SortKey = "agent" | "count" | "rescued" | "rate" | "minutes" | "sites";
type Sort = { key: SortKey; dir: "asc" | "desc" };

// Five steps of ink mixed into a wax cell. Steps 0-2 carry dark text, 3-4 pale.
const FILL = [10, 24, 40, 70, 94];
const fillOf = (level: number) => `color-mix(in srgb, var(--color-ink) ${FILL[level]}%, var(--color-panel))`;
const levelOf = (n: number, max: number) => Math.min(4, Math.floor(Math.sqrt(n / Math.max(1, max)) * 5));

function Meter({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-1.5 w-full min-w-16 overflow-hidden rounded-full bg-ink/15" role="img" aria-label={label}>
        <div className="h-full rounded-full bg-rescue" style={{ width: `${value}%` }} />
      </div>
      <span className="tabular w-10 shrink-0 text-right font-mono text-xs font-semibold text-rescue">{value}%</span>
    </div>
  );
}

function LiveDot({ className }: { className?: string }) {
  return <span aria-hidden="true" className={clsx("inline-block h-2 w-2 shrink-0 rounded-full bg-distress", className)} />;
}

function SortTh({
  label,
  k,
  sort,
  onSort,
  disabled,
  align = "right",
  className,
}: {
  label: string;
  k: SortKey;
  sort: Sort;
  onSort: (k: SortKey) => void;
  disabled?: boolean;
  align?: "left" | "right";
  className?: string;
}) {
  const on = sort.key === k && !disabled;
  return (
    <th
      scope="col"
      aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={clsx("px-3 py-3 font-normal first:pl-5 last:pr-5", align === "right" ? "text-right" : "text-left", className)}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSort(k)}
        className={clsx(
          "label inline-flex items-center gap-1.5 rounded-full px-2 py-1 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
          align === "right" && "flex-row-reverse",
          disabled ? "cursor-not-allowed opacity-50" : "hover:bg-ink/10",
          on && "bg-ink/10 !text-ink",
        )}
      >
        {label}
        <span aria-hidden="true" className={clsx("text-[10px]", on ? "opacity-100" : "opacity-30")}>
          {on && sort.dir === "asc" ? "▲" : "▼"}
        </span>
      </button>
    </th>
  );
}

export function AgentsClient({ rows, vendors }: { rows: AgentRow[]; vendors: VendorRef[] }) {
  const [liveOnly, setLiveOnly] = useState(false);
  const [sort, setSort] = useState<Sort>({ key: "count", dir: "desc" });
  const [active, setActive] = useState<string | null>(null);

  const data = useMemo(() => {
    const n = (a: Agg) => (liveOnly ? a.live : a.maydays);
    const agents = aggregate(rows, (r) => r.agent).filter((a) => n(a) > 0);
    const models = aggregate(rows, (r) => r.model)
      .filter((a) => n(a) > 0)
      .sort((a, b) => n(b) - n(a) || a.key.localeCompare(b.key));
    const cells = new Map(aggregate(rows, (r) => r.agent + SEP + r.vendor).map((a) => [a.key, a]));
    const known = new Map(vendors.map((v) => [v.slug, v]));
    const cols = aggregate(rows, (r) => r.vendor)
      .filter((a) => n(a) > 0)
      .sort((a, b) => n(b) - n(a) || a.key.localeCompare(b.key))
      .map((a) => known.get(a.key) ?? { slug: a.key, name: a.key, color: "var(--color-ink)" });
    let cellMax = 0;
    for (const c of cells.values()) cellMax = Math.max(cellMax, n(c));
    const all = aggregate(rows, () => "all")[0] ?? { key: "all", maydays: 0, rescued: 0, minutes: 0, sites: 0, live: 0 };
    return { n, agents, models, cells, cols, cellMax, all };
  }, [rows, vendors, liveOnly]);

  const { n, all } = data;
  const sortKey: SortKey = liveOnly && sort.key !== "agent" && sort.key !== "count" ? "count" : sort.key;
  const effSort: Sort = { key: sortKey, dir: sortKey === sort.key ? sort.dir : "desc" };

  const board = useMemo(() => {
    const val = (a: Agg): number =>
      sortKey === "count"
        ? n(a)
        : sortKey === "rescued"
          ? a.rescued
          : sortKey === "rate"
            ? a.maydays
              ? a.rescued / a.maydays
              : 0
            : sortKey === "minutes"
              ? a.minutes
              : a.sites;
    const sign = effSort.dir === "asc" ? 1 : -1;
    return [...data.agents].sort((a, b) => {
      const c = sortKey === "agent" ? a.key.localeCompare(b.key) : val(a) - val(b);
      return c * sign || n(b) - n(a) || a.key.localeCompare(b.key);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, sortKey, effSort.dir]);

  const matrixRows = useMemo(() => [...data.agents].sort((a, b) => n(b) - n(a) || a.key.localeCompare(b.key)), [data, n]);
  const boardMax = Math.max(1, ...data.agents.map(n));
  const modelMax = Math.max(1, ...data.models.map(n));

  const onSort = (k: SortKey) =>
    setSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: k === "agent" ? "asc" : "desc" }));

  const livePct = all.maydays ? Math.round((all.live / all.maydays) * 100) : 0;
  const total = n(all);
  const activeCell = active ? data.cells.get(active) : undefined;
  const [activeAgent, activeVendorSlug] = active ? active.split(SEP) : ["", ""];
  const activeVendor = data.cols.find((v) => v.slug === activeVendorSlug);
  const dash = <span className="text-dim">–</span>;

  return (
    <>
      {/* Controls and the honest note */}
      <section className="rule grid gap-6 py-8 lg:grid-cols-12 lg:items-center" aria-label="Data source">
        <div className="lg:col-span-4">
          <button
            type="button"
            role="switch"
            aria-checked={liveOnly}
            onClick={() => {
              setLiveOnly((v) => !v);
              setActive(null);
            }}
            className="group inline-flex items-center gap-3 rounded-full border border-ink bg-panel py-2 pl-2 pr-5 text-sm font-semibold text-ink transition-colors hover:bg-panel-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            <span
              aria-hidden="true"
              className={clsx("relative h-7 w-12 rounded-full transition-colors", liveOnly ? "bg-ink" : "bg-ink/20")}
            >
              <span
                className={clsx(
                  "absolute top-1 h-5 w-5 rounded-full transition-all",
                  liveOnly ? "left-6 bg-comb" : "left-1 bg-ink",
                )}
              />
            </span>
            Live only
            <span className="font-mono text-[11px] font-normal uppercase tracking-[0.12em] text-mute">{liveOnly ? "on" : "off"}</span>
          </button>
        </div>
        <p className="text-sm leading-relaxed text-mute lg:col-span-8">
          <strong className="font-semibold text-ink">Most of this page is charted, not observed.</strong> The bulk of the maydays
          here were charted from known failure patterns for each vendor.{" "}
          <span className="tabular text-ink">
            {all.live.toLocaleString()} of {all.maydays.toLocaleString()}
          </span>{" "}
          ({livePct}%) came from test flights or live agent traffic; those are marked with a{" "}
          <LiveDot className="mx-0.5 align-baseline" /> dot.
          {liveOnly ? (
            <>
              {" "}
              <strong className="font-semibold text-ink">
                Live only is on: you are seeing mayday counts and nothing else.
              </strong>{" "}
              Rescues, hours lost and crash sites are not recorded per source, so they are left blank rather than guessed.
            </>
          ) : null}
        </p>
      </section>

      <section className="rule grid grid-cols-2 gap-x-6 gap-y-10 py-10 sm:py-12 lg:grid-cols-4" aria-label="Totals">
        <Stat label="Agents" value={data.agents.length} hint={liveOnly ? "With test-flight or live maydays" : "Distinct agent clients"} />
        <Stat label="Models" value={data.models.length} hint="Distinct model ids reported" />
        <Stat
          label={liveOnly ? "Live maydays" : "Maydays"}
          value={total.toLocaleString()}
          tone="distress"
          hint={liveOnly ? "Test flights and live traffic" : `${all.live.toLocaleString()} from test flights or live traffic`}
        />
        <Stat
          label="Rescue rate"
          value={liveOnly ? "–" : `${rescueRate(all.maydays, all.rescued)}%`}
          tone={liveOnly ? "mute" : "rescue"}
          hint={liveOnly ? "Not split by source" : `${all.rescued.toLocaleString()} rescued, ${minutesToHuman(all.minutes)} lost`}
        />
      </section>

      {total === 0 ? (
        <section className="rule py-12 sm:py-16">
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-ink/15 bg-panel px-6 py-14 text-center">
            <Bee className="h-10 w-12 animate-hover-bee text-ink" />
            <h2 className="text-2xl !font-bold text-ink sm:text-3xl">
              {liveOnly ? "No live maydays yet." : "No maydays on the map yet."}
            </h2>
            <p className="max-w-md text-sm leading-relaxed text-mute">
              {liveOnly
                ? "Everything on this page so far is charted from known failure patterns. Run a test flight, or point an agent at Mayday, and it will show up here."
                : "Once agents start reporting where they go down, this page breaks it out by agent, model and vendor."}
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <ButtonLink href="/flights">Run a test flight</ButtonLink>
              {liveOnly ? (
                <button
                  type="button"
                  onClick={() => setLiveOnly(false)}
                  className="inline-flex items-center rounded-full border border-ink px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-ink hover:text-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                >
                  Show charted data
                </button>
              ) : null}
            </div>
          </div>
        </section>
      ) : (
        <>
          {/* 01 Leaderboard */}
          <section className="rule py-12 sm:py-16" aria-labelledby="board-heading">
            <div className="grid gap-6 lg:grid-cols-12 lg:gap-10">
              <div className="lg:col-span-6">
                <span className="label">01 — Leaderboard</span>
                <h2 id="board-heading" className="mt-4 text-4xl !font-extrabold tracking-tight text-ink sm:text-5xl">
                  Agents, by how often they go down.
                </h2>
              </div>
              <p className="max-w-xl text-[15px] leading-relaxed text-mute lg:col-span-6 lg:pt-8">
                Each agent, added up across every model it runs and every vendor it touches. Click a column to sort.
                {liveOnly ? " With live only on, the list can be sorted by agent or by mayday count." : null}
              </p>
            </div>
            <div className="scroll-thin mt-10 overflow-x-auto rounded-2xl border border-ink/15 bg-panel">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-ink/15">
                    <th scope="col" className="w-10 py-3 pl-5 text-left font-normal">
                      <span className="label">#</span>
                    </th>
                    <SortTh label="Agent" k="agent" sort={effSort} onSort={onSort} align="left" />
                    <SortTh label={liveOnly ? "Live maydays" : "Maydays"} k="count" sort={effSort} onSort={onSort} />
                    <SortTh label="Rescued" k="rescued" sort={effSort} onSort={onSort} disabled={liveOnly} />
                    <SortTh label="Rescue rate" k="rate" sort={effSort} onSort={onSort} disabled={liveOnly} className="w-[22%]" />
                    <SortTh label="Agent-hours lost" k="minutes" sort={effSort} onSort={onSort} disabled={liveOnly} />
                    <SortTh label="Crash sites" k="sites" sort={effSort} onSort={onSort} disabled={liveOnly} />
                  </tr>
                </thead>
                <tbody>
                  {board.map((a, i) => {
                    const rate = rescueRate(a.maydays, a.rescued);
                    return (
                      <tr key={a.key} className="border-b border-ink/15 transition-colors last:border-b-0 hover:bg-ink/5">
                        <td className="tabular py-4 pl-5 font-mono text-xs text-dim">{String(i + 1).padStart(2, "0")}</td>
                        <th scope="row" className="px-3 py-4 pl-5 text-left font-normal">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[15px] font-semibold text-ink">{a.key}</span>
                            {a.live > 0 && !liveOnly ? (
                              <Badge title={`${a.live} maydays from test flights or live traffic`}>
                                <LiveDot className="h-1.5 w-1.5" />
                                {a.live} live
                              </Badge>
                            ) : null}
                          </span>
                        </th>
                        <td className="px-3 py-4 text-right">
                          <div className="flex items-center justify-end gap-3">
                            <div className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-ink/15 sm:block" aria-hidden="true">
                              <div className="ml-auto h-full rounded-full bg-distress" style={{ width: `${(n(a) / boardMax) * 100}%` }} />
                            </div>
                            <span className="tabular w-12 text-right text-lg font-bold text-distress">{n(a).toLocaleString()}</span>
                          </div>
                        </td>
                        <td className="tabular px-3 py-4 text-right font-semibold text-rescue">
                          {liveOnly ? dash : a.rescued.toLocaleString()}
                        </td>
                        <td className="px-3 py-4">
                          {liveOnly ? (
                            <div className="text-right">{dash}</div>
                          ) : (
                            <Meter value={rate} label={`${rate}% of ${a.key} maydays were rescued`} />
                          )}
                        </td>
                        <td className="tabular px-3 py-4 text-right text-ink">{liveOnly ? dash : minutesToHuman(a.minutes)}</td>
                        <td className="tabular px-3 py-4 pr-5 text-right text-ink">{liveOnly ? dash : a.sites.toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-mute">
              Crash-site counts are a floor: where an agent runs several models against one vendor, the largest count is used
              rather than a sum that would count the same site twice.
            </p>
          </section>

          {/* 02 Matrix */}
          <section className="rule py-12 sm:py-16" aria-labelledby="matrix-heading">
            <div className="grid gap-6 lg:grid-cols-12 lg:gap-10">
              <div className="lg:col-span-6">
                <span className="label">02 — Agent × vendor</span>
                <h2 id="matrix-heading" className="mt-4 text-4xl !font-extrabold tracking-tight text-ink sm:text-5xl">
                  Where each one goes down.
                </h2>
              </div>
              <p className="max-w-xl text-[15px] leading-relaxed text-mute lg:col-span-6 lg:pt-8">
                One cell per agent and vendor. The darker the cell, the more maydays.{" "}
                {liveOnly ? "The number is the count of live maydays." : "The number is the share that were rescued."} Hover or
                focus a cell for exact figures; a column header opens that vendor&rsquo;s tower.
              </p>
            </div>

            <div className="mt-10 rounded-2xl border border-ink/15 bg-panel p-4 sm:p-6">
              {/* Readout */}
              <div
                aria-live="polite"
                className="flex min-h-[4.5rem] flex-wrap items-center gap-x-8 gap-y-2 border-b border-ink/15 pb-4"
              >
                {activeCell && n(activeCell) > 0 ? (
                  <>
                    <div className="min-w-40">
                      <span className="label">Reading</span>
                      <div className="mt-1 font-mono text-sm font-semibold text-ink">
                        {activeAgent} <span className="text-mute">×</span> {activeVendor?.name ?? activeVendorSlug}
                      </div>
                    </div>
                    <Readout label={liveOnly ? "Live maydays" : "Maydays"} value={n(activeCell).toLocaleString()} className="text-distress" />
                    {liveOnly ? (
                      <span className="text-xs text-mute">Rescues, hours and sites are not split by source.</span>
                    ) : (
                      <>
                        <Readout label="Rescued" value={activeCell.rescued.toLocaleString()} className="text-rescue" />
                        <Readout
                          label="Rescue rate"
                          value={`${rescueRate(activeCell.maydays, activeCell.rescued)}%`}
                          className="text-rescue"
                        />
                        <Readout label="Hours lost" value={minutesToHuman(activeCell.minutes)} />
                        <Readout label="Crash sites" value={activeCell.sites.toLocaleString()} />
                        <Readout label="Test flight / live" value={activeCell.live.toLocaleString()} />
                      </>
                    )}
                  </>
                ) : (
                  <div className="flex items-center gap-3 text-sm text-mute">
                    <Bee className="h-5 w-6 text-ink" />
                    Hover or focus a cell to read its exact numbers.
                  </div>
                )}
              </div>

              <div className="scroll-thin overflow-x-auto pt-4">
                <table className="border-separate border-spacing-x-1 border-spacing-y-1.5">
                  <thead>
                    <tr>
                      <th scope="col" className="sticky left-0 z-10 bg-panel pr-4 text-left align-bottom font-normal">
                        <span className="label">Agent</span>
                      </th>
                      {data.cols.map((v) => (
                        <th key={v.slug} scope="col" className="w-[76px] min-w-[76px] pb-2 align-bottom font-normal">
                          <Link
                            href={`/tower/${v.slug}`}
                            title={`Open the ${v.name} tower`}
                            className="group mx-auto flex w-[76px] flex-col items-center gap-1.5 rounded-xl px-1 py-1.5 text-ink transition-colors hover:bg-ink hover:text-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                          >
                            <span
                              aria-hidden="true"
                              className="h-2.5 w-2.5 rounded-full border border-ink/50 group-hover:border-bg/60"
                              style={{ background: v.color }}
                            />
                            <span className="w-full truncate text-center text-xs font-semibold">{v.name}</span>
                          </Link>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrixRows.map((a) => (
                      <tr key={a.key}>
                        <th scope="row" className="sticky left-0 z-10 max-w-44 bg-panel pr-4 text-left font-normal">
                          <span className="block truncate font-mono text-sm font-semibold text-ink">{a.key}</span>
                          <span className="tabular block font-mono text-[11px] text-mute">{n(a).toLocaleString()} maydays</span>
                        </th>
                        {data.cols.map((v) => {
                          const id = a.key + SEP + v.slug;
                          const c = data.cells.get(id);
                          const count = c ? n(c) : 0;
                          if (!c || count === 0) {
                            return (
                              <td key={v.slug} className="p-0 text-center">
                                <div className="relative mx-auto h-[76px] w-[68px]" aria-label={`${a.key} on ${v.name}: no maydays`}>
                                  <span className="hex absolute inset-0 bg-ink/10" />
                                  <span className="hex absolute inset-[1.5px] bg-panel" />
                                </div>
                              </td>
                            );
                          }
                          const level = levelOf(count, data.cellMax);
                          const rate = rescueRate(c.maydays, c.rescued);
                          const text = liveOnly
                            ? `${a.key} on ${v.name}: ${count} live maydays`
                            : `${a.key} on ${v.name}: ${c.maydays} maydays, ${c.rescued} rescued (${rate}%), ${minutesToHuman(c.minutes)} lost, ${c.sites} crash sites, ${c.live} from test flights or live traffic`;
                          const on = active === id;
                          return (
                            <td key={v.slug} className="p-0 text-center">
                              <button
                                type="button"
                                aria-label={text}
                                title={text}
                                onMouseEnter={() => setActive(id)}
                                onFocus={() => setActive(id)}
                                onClick={() => setActive(id)}
                                className="group relative mx-auto block h-[76px] w-[68px] outline-none transition-transform hover:-translate-y-0.5 focus-visible:-translate-y-0.5"
                              >
                                <span
                                  className={clsx(
                                    "hex absolute inset-0 transition-colors group-hover:bg-ink group-focus-visible:bg-ink",
                                    on ? "bg-ink" : "bg-ink/25",
                                  )}
                                />
                                <span
                                  className={clsx(
                                    "hex absolute flex flex-col items-center justify-center transition-all",
                                    on ? "inset-[4px]" : "inset-[1.5px] group-hover:inset-[4px] group-focus-visible:inset-[4px]",
                                    level >= 3 ? "text-comb" : "text-ink",
                                  )}
                                  style={{ background: fillOf(level) }}
                                >
                                  <span className="tabular text-[15px] font-bold leading-none">{liveOnly ? count : `${rate}%`}</span>
                                  <span className="tabular mt-1 font-mono text-[9.5px] leading-none opacity-80">
                                    {liveOnly ? "live" : count.toLocaleString()}
                                  </span>
                                </span>
                                {c.live > 0 && !liveOnly ? <LiveDot className="absolute right-0.5 top-1.5 ring-2 ring-panel" /> : null}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Legend */}
              <div className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-ink/15 pt-4 text-xs text-mute">
                <div className="flex items-center gap-2">
                  <span>Fewer maydays</span>
                  <span className="flex items-center gap-1" aria-hidden="true">
                    {FILL.map((_, i) => (
                      <span key={i} className="hex h-5 w-[18px]" style={{ background: fillOf(i) }} />
                    ))}
                  </span>
                  <span>More</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="relative h-5 w-[18px]" aria-hidden="true">
                    <span className="hex absolute inset-0 bg-ink/10" />
                    <span className="hex absolute inset-[1.5px] bg-panel" />
                  </span>
                  <span>No maydays</span>
                </div>
                {!liveOnly ? (
                  <div className="flex items-center gap-2">
                    <LiveDot />
                    <span>Includes test-flight or live maydays</span>
                  </div>
                ) : null}
                <span>{liveOnly ? "Large number: live maydays." : "Large number: rescue rate. Small number: maydays."}</span>
              </div>
            </div>
          </section>

          {/* 03 Models */}
          <section className="rule py-12 sm:py-16" aria-labelledby="models-heading">
            <div className="grid gap-6 lg:grid-cols-12 lg:gap-10">
              <div className="lg:col-span-6">
                <span className="label">03 — Models</span>
                <h2 id="models-heading" className="mt-4 text-4xl !font-extrabold tracking-tight text-ink sm:text-5xl">
                  The model underneath.
                </h2>
              </div>
              <p className="max-w-xl text-[15px] leading-relaxed text-mute lg:col-span-6 lg:pt-8">
                The same maydays, grouped by the model id the agent reported, across every agent that runs it. Agents that did
                not report a model are listed as <code className="font-mono text-[0.88em] text-ink">unknown</code>.
              </p>
            </div>
            <div className="scroll-thin mt-10 overflow-x-auto rounded-2xl border border-ink/15 bg-panel">
              <table className="w-full min-w-[620px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-ink/15">
                    <th scope="col" className="py-4 pl-5 pr-3 text-left font-normal">
                      <span className="label">Model id</span>
                    </th>
                    <th scope="col" className="px-3 py-4 text-right font-normal">
                      <span className="label">{liveOnly ? "Live maydays" : "Maydays"}</span>
                    </th>
                    <th scope="col" className="w-[30%] px-3 py-4 text-right font-normal">
                      <span className="label">Rescue rate</span>
                    </th>
                    <th scope="col" className="py-4 pl-3 pr-5 text-right font-normal">
                      <span className="label">Hours lost</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.models.map((m) => {
                    const rate = rescueRate(m.maydays, m.rescued);
                    return (
                      <tr key={m.key} className="border-b border-ink/15 transition-colors last:border-b-0 hover:bg-ink/5">
                        <th scope="row" className="py-4 pl-5 pr-3 text-left font-normal">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className={clsx("font-mono text-sm font-semibold", m.key === "unknown" ? "text-mute" : "text-ink")}>
                              {m.key}
                            </span>
                            {m.live > 0 && !liveOnly ? (
                              <Badge title={`${m.live} maydays from test flights or live traffic`}>
                                <LiveDot className="h-1.5 w-1.5" />
                                {m.live} live
                              </Badge>
                            ) : null}
                          </span>
                        </th>
                        <td className="px-3 py-4 text-right">
                          <div className="flex items-center justify-end gap-3">
                            <div className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-ink/15 sm:block" aria-hidden="true">
                              <div className="ml-auto h-full rounded-full bg-distress" style={{ width: `${(n(m) / modelMax) * 100}%` }} />
                            </div>
                            <span className="tabular w-12 text-right text-base font-bold text-distress">{n(m).toLocaleString()}</span>
                          </div>
                        </td>
                        <td className="px-3 py-4">
                          {liveOnly ? (
                            <div className="text-right">{dash}</div>
                          ) : (
                            <Meter value={rate} label={`${rate}% of ${m.key} maydays were rescued`} />
                          )}
                        </td>
                        <td className="tabular py-4 pl-3 pr-5 text-right text-ink">{liveOnly ? dash : minutesToHuman(m.minutes)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}

function Readout({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className={clsx("tabular mt-1 text-xl font-bold leading-none", className ?? "text-ink")}>{value}</div>
    </div>
  );
}
