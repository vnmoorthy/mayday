import Link from "next/link";
import clsx from "clsx";
import type { Route, Source } from "@/lib/types";
import { Badge } from "@/components/ui";
import { CopyButton } from "@/components/cockpit/copy-button";
import { CARD, FOCUS, TCAP, TSCROLL, TSELECT } from "@/components/cockpit/theme";

// One waggle route: the task, how often agents landed it, the steps, the
// snippet and the crash sites it steers around. No state of its own, so it
// renders on the server and inside the client search alike.

const SOURCE_LABEL: Record<Source, string> = { seed: "charted", harvest: "test flight", live: "live" };

export const successRate = (r: Route) => {
  const tries = r.landings + r.failures;
  return tries > 0 ? Math.round((r.landings / tries) * 100) : null;
};

export const avgMinutes = (r: Route) => (r.landings > 0 && r.minutes_sum > 0 ? Math.round(r.minutes_sum / r.landings) : null);

const siteTitle = (slug: string) => slug.replace(/^(stripe|supabase|vercel|anthropic)-/, "").replace(/-/g, " ");

export function RouteCard({ route, showVendor = false, className }: { route: Route; showVendor?: boolean; className?: string }) {
  const rate = successRate(route);
  const avg = avgMinutes(route);
  const steps = [...route.steps].sort((a, b) => a.n - b.n);

  return (
    <article className={clsx(CARD, "flex min-w-0 flex-col gap-5 p-5 sm:p-6", className)}>
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {showVendor && route.vendor ? <Badge tone="radar">{route.vendor}</Badge> : null}
          <Badge tone={route.source === "live" ? "rescue" : "mute"}>{SOURCE_LABEL[route.source]}</Badge>
        </div>
        <h3 className="text-xl font-bold! leading-snug tracking-tight text-ink sm:text-2xl">{route.task}</h3>
      </header>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 font-mono text-[12px] text-mute">
          <span className="tabular">
            <span className="font-semibold text-ink">landed {route.landings.toLocaleString("en-US")}</span>
            {" · "}
            <span className={route.failures > 0 ? "text-distress" : undefined}>failed {route.failures.toLocaleString("en-US")}</span>
          </span>
          <span className="tabular">
            {rate === null ? "not flown yet" : `${rate}% land it`}
            {avg !== null ? ` · saves ~${avg} min` : ""}
          </span>
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-ink/15"
          role="meter"
          aria-label="Success rate"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={rate ?? 0}
        >
          <div className="h-full rounded-full bg-ink" style={{ width: `${rate ?? 0}%` }} />
        </div>
      </div>

      {steps.length ? (
        <ol className="flex flex-col gap-2.5">
          {steps.map((s, i) => (
            <li key={`${s.n}-${i}`} className="flex gap-3 text-[14.5px] leading-relaxed text-ink">
              <span className="tabular mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink font-mono text-[11px] font-semibold text-bg">
                {i + 1}
              </span>
              <span className="min-w-0 break-words">{s.text}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {route.snippet ? (
        <div className="terminal min-w-0 overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-comb/15 px-4 py-2.5">
            <span className={clsx(TCAP, "truncate")}>The way through</span>
            <CopyButton text={route.snippet} />
          </div>
          <pre className={clsx("max-h-80 overflow-auto px-4 py-4 font-mono text-[12.5px] leading-relaxed text-comb", TSCROLL, TSELECT)}>
            <code>{route.snippet}</code>
          </pre>
        </div>
      ) : null}

      {route.pitfalls.length ? (
        <div className="mt-auto flex flex-col gap-2 border-t border-ink/15 pt-4">
          <span className="label">Crash sites this route avoids</span>
          <div className="flex flex-wrap gap-2">
            {route.pitfalls.map((slug) => (
              <Link
                key={slug}
                href={`/site/${slug}`}
                className={clsx(
                  "rounded-full border border-distress/50 bg-distress/10 px-3 py-1 font-mono text-[11.5px] text-distress transition-colors hover:bg-distress hover:text-comb",
                  FOCUS,
                )}
              >
                {siteTitle(slug)}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}
