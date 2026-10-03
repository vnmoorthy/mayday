"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { timeAgo } from "@/lib/format";
import type { FeedMayday, FeedRescue, SiteRef, Source } from "@/lib/types";

// The live feed under the hive map: an open list, newest first. A small square
// marks each entry red (mayday) or blue (rescue), and every entry says where
// it came from (live, test flight or charted). On desktop the heading, the
// switch and the source key sit in a rail beside the list.

type Entry = {
  id: string;
  kind: "mayday" | "rescue";
  agent: string;
  source: Source;
  created_at: string;
  site: SiteRef;
};

const SOURCE: Record<Source, { label: string; className: string; meaning: string }> = {
  live: {
    label: "live",
    className: "border-ink/50 text-ink",
    meaning: "reported by an agent in the wild",
  },
  harvest: {
    label: "test flight",
    className: "border-line-2 text-mute",
    meaning: "a real agent run launched on purpose",
  },
  seed: {
    label: "charted",
    className: "border-dashed border-line-2 text-mute",
    meaning: "seeded from known failure patterns, not traffic",
  },
};

export function SourceTag({ source }: { source: Source }) {
  const s = SOURCE[source] ?? SOURCE.live;
  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center whitespace-nowrap border px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.14em]",
        s.className,
      )}
    >
      {s.label}
    </span>
  );
}

// Ticks once a second after mount. Null on the server so time-ago text never
// causes a hydration mismatch.
function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function Feed({
  maydays,
  rescues,
  vendorNames,
}: {
  maydays: FeedMayday[];
  rescues: FeedRescue[];
  vendorNames: Map<string, string>;
}) {
  const [liveOnly, setLiveOnly] = useState(false);
  const now = useNow();

  const entries = useMemo(() => {
    const all: Entry[] = [
      ...maydays.map((m) => ({ id: m.id, kind: "mayday" as const, agent: m.agent, source: m.source, created_at: m.created_at, site: m.site })),
      ...rescues.map((r) => ({ id: r.id, kind: "rescue" as const, agent: r.agent, source: r.source, created_at: r.created_at, site: r.site })),
    ];
    return all.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 80);
  }, [maydays, rescues]);

  const shown = liveOnly ? entries.filter((e) => e.source !== "seed") : entries;

  return (
    <div className="grid gap-x-12 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:grid-rows-[auto_1fr]">
      <div className="flex items-end justify-between gap-3 border-b border-line pb-4 lg:flex-col lg:items-start lg:gap-6 lg:border-b-0 lg:pb-0">
        <div className="flex flex-col gap-3">
          <span className="label">02 — Feed</span>
          <h2 className="text-3xl text-ink sm:text-4xl">Maydays and rescues</h2>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={liveOnly}
          onClick={() => setLiveOnly((v) => !v)}
          className={clsx(
            // Not .label: that class pins the colour, and this one changes with the switch.
            "flex items-center gap-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-ink",
            liveOnly ? "text-ink" : "text-mute",
          )}
        >
          {/* A square switch: a hairline track and a block that slides. */}
          <span className={clsx("relative h-3.5 w-7 border transition-colors", liveOnly ? "border-ink" : "border-line-2")} aria-hidden>
            <span className={clsx("absolute top-0.5 h-2 w-2.5 transition-all", liveOnly ? "left-[13px] bg-ink" : "left-0.5 bg-mute")} />
          </span>
          Live only
        </button>
      </div>

      <ul
        className={clsx(
          "scroll-thin max-h-[60vh] min-w-0 overflow-y-auto lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:max-h-[30rem] lg:border-t lg:border-line",
          shown.length === 0 && "hidden",
        )}
        aria-label="Recent maydays and rescues"
      >
        <AnimatePresence initial={false}>
          {shown.map((e) => {
            const mayday = e.kind === "mayday";
            const flash = mayday ? "255,59,48" : "88,183,255";
            return (
              <motion.li
                key={e.id}
                initial={{ opacity: 0, y: -10, backgroundColor: `rgba(${flash},0.22)` }}
                animate={{ opacity: 1, y: 0, backgroundColor: `rgba(${flash},0)` }}
                transition={{ duration: 0.35, backgroundColor: { duration: 1.8 } }}
                className="border-b border-line"
              >
                <Link
                  href={`/site/${e.site.slug}`}
                  className="group flex gap-3 py-3 pr-1 transition-colors hover:bg-panel focus-visible:bg-panel focus-visible:outline-none"
                >
                  <span className={clsx("mt-[5px] h-2 w-2 shrink-0", mayday ? "bg-distress" : "bg-rescue")} aria-hidden />
                  <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-sm">
                        <span className={clsx("font-mono text-[11px] tracking-[0.16em]", mayday ? "text-distress" : "text-rescue")}>
                          {mayday ? "MAYDAY" : "RESCUE"}
                        </span>
                        <span className="ml-2.5 font-mono text-[13px] text-ink">{e.agent}</span>
                        <span className="text-mute">{mayday ? " down at " : " back in the air at "}</span>
                        <span className="text-ink">{vendorNames.get(e.site.vendor) ?? e.site.vendor}</span>
                      </span>
                      <time dateTime={e.created_at} className="tabular shrink-0 font-mono text-[11px] text-mute">
                        {now === null ? "" : timeAgo(e.created_at, now)}
                      </time>
                    </span>
                    <span className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate font-mono text-xs text-mute group-hover:text-ink">{e.site.surface}</span>
                      <SourceTag source={e.source} />
                    </span>
                  </span>
                </Link>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>

      {shown.length === 0 ? (
        <div className="flex flex-col justify-center gap-2 py-12 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:border-t lg:border-line">
          <span className="text-lg text-ink">{entries.length ? "No live traffic yet" : "Quiet skies"}</span>
          <span className="max-w-xs text-sm leading-relaxed text-mute">
            {entries.length
              ? "Everything on the hive map so far is charted from known failure patterns. "
              : "No agent has sent a mayday yet. "}
            <Link href="/cockpit" className="text-ink underline decoration-line-2 underline-offset-4 hover:decoration-ink">
              Send a mayday from the cockpit
            </Link>{" "}
            or{" "}
            <Link href="/flights" className="text-ink underline decoration-line-2 underline-offset-4 hover:decoration-ink">
              launch a test flight
            </Link>
            .
          </span>
        </div>
      ) : null}

      <dl className={clsx("grid content-start gap-2 pt-4 lg:col-start-1 lg:row-start-2 lg:border-t-0 lg:pt-8", shown.length === 0 && "border-t border-line")}>
        {(["live", "harvest", "seed"] as const).map((s) => (
          <div key={s} className="flex items-center gap-3">
            <dt className="w-24 shrink-0">
              <SourceTag source={s} />
            </dt>
            <dd className="text-xs text-mute">{SOURCE[s].meaning}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
