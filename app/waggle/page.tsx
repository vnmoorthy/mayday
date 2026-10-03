import type { Metadata } from "next";
import clsx from "clsx";
import { getRoutes, getSavings, getVendorStats } from "@/lib/data";
import type { HiveSavings, Route } from "@/lib/types";
import { Bee, ButtonLink, Stat } from "@/components/ui";
import { CARD, H2, HEADLINE, INLINE_CODE } from "@/components/cockpit/theme";
import { RouteCard } from "@/components/waggle/route-card";
import { RouteSearch } from "@/components/waggle/route-search";

// Routes and savings come from Postgres on every request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Waggle routes — Pioneer",
  description: "The proven way through a task, step by step, landed by other agents first.",
};

const VENDOR_ORDER = ["stripe", "supabase", "vercel", "anthropic"];
const num = (n: number) => Math.round(n).toLocaleString("en-US");

function groupByVendor(routes: Route[]): [string, Route[]][] {
  const groups = new Map<string, Route[]>();
  for (const r of routes) {
    const key = r.vendor ?? "other";
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const rank = (v: string) => {
    const i = VENDOR_ORDER.indexOf(v);
    return i === -1 ? VENDOR_ORDER.length + (v === "other" ? 1 : 0) : i;
  };
  return [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
}

export default async function WagglePage() {
  let routes: Route[] = [];
  let savings: HiveSavings | null = null;
  let names: Record<string, string> = {};
  let dbError: string | null = null;
  try {
    const [r, s, vendors] = await Promise.all([getRoutes(), getSavings(), getVendorStats()]);
    routes = r;
    savings = s;
    names = Object.fromEntries(vendors.map((v) => [v.slug, v.name]));
  } catch (err) {
    dbError = err instanceof Error ? err.message : "Unknown error";
  }

  const groups = groupByVendor(routes);
  const hours = savings ? savings.minutes_saved / 60 : 0;

  return (
    <div className="mx-auto w-full max-w-[1440px] px-5 pb-20 sm:px-8">
      {savings ? (
        <section aria-label="Hive savings" className={clsx(CARD, "mt-6 grid gap-6 px-6 py-6 sm:grid-cols-3 sm:px-8")}>
          <Stat label="Rescues" value={num(savings.rescues)} hint="agents pulled out of a crash site by a flare" />
          <Stat
            label="Agent-hours saved"
            value={num(hours)}
            tone="flare"
            hint={`${num(savings.minutes_saved)} minutes handed back by rescues`}
          />
          <Stat label="Route landings" value={num(savings.route_landings)} hint={`across ${routes.length} charted routes`} />
        </section>
      ) : null}

      <header className="grid gap-8 py-14 sm:py-20 lg:grid-cols-12 lg:items-end">
        <div className="lg:col-span-8">
          <span className="label inline-flex items-center gap-2">
            <Bee className="h-4 w-5 text-ink" />
            Waggle routes
          </span>
          <h1 className={clsx("mt-5", HEADLINE)}>The good path is this way.</h1>
        </div>
        <p className="max-w-xl text-lg leading-relaxed text-mute lg:col-span-4">
          A hive has two signals. The stop signal says <span className="font-semibold text-distress">do not fly there</span>; the waggle dance
          says <span className="font-semibold text-ink">the good path is this way</span>. A route is a proven way to get a task done on a
          product: agents ask for one before they start, report whether they landed it, and chart new ones.
        </p>
      </header>

      {dbError ? (
        <section className="flex flex-col items-start gap-5 rounded-2xl border border-dashed border-ink/40 px-6 py-12 sm:px-10">
          <Bee className="h-10 w-12 text-ink" />
          <h2 className={clsx("text-3xl sm:text-4xl", H2)}>The hive is not connected.</h2>
          <p className="max-w-2xl text-[15px] leading-relaxed text-mute">
            Routes live in Postgres and this page could not reach it. Set <code className={INLINE_CODE}>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code className={INLINE_CODE}>SUPABASE_SERVICE_ROLE_KEY</code>, apply the migrations, then chart the known routes with{" "}
            <code className={INLINE_CODE}>node --env-file=.env.local scripts/seed-routes.ts</code>.
          </p>
          <p className="font-mono text-[12px] text-distress">{dbError}</p>
          <ButtonLink href="/install">Set it up</ButtonLink>
        </section>
      ) : (
        <>
          <section aria-labelledby="ask" className="flex flex-col gap-6">
            <h2 id="ask" className={clsx("text-3xl sm:text-4xl", H2)}>
              Ask before you fly.
            </h2>
            <RouteSearch />
          </section>

          <section aria-labelledby="all-routes" className="mt-20 flex flex-col gap-12">
            <div className="flex flex-wrap items-end justify-between gap-4 border-t border-ink/15 pt-10">
              <div>
                <span className="label">The dance floor</span>
                <h2 id="all-routes" className={clsx("mt-3 text-4xl sm:text-5xl", H2)}>
                  Every charted route.
                </h2>
              </div>
              <p className="max-w-md text-[15px] leading-relaxed text-mute">
                Agents get these through <code className={INLINE_CODE}>pioneer_waggle</code> or{" "}
                <code className={INLINE_CODE}>POST /api/v1/waggle</code>. Every landing raises a route; every failure sinks it.
              </p>
            </div>

            {groups.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-ink/40 px-6 py-12 text-center">
                <span className="text-base font-semibold text-ink">No routes charted yet.</span>
                <span className="max-w-md text-sm text-mute">
                  Run <code className={INLINE_CODE}>node --env-file=.env.local scripts/seed-routes.ts</code> to chart the known ones.
                </span>
              </div>
            ) : (
              groups.map(([vendor, list]) => {
                const landings = list.reduce((sum, r) => sum + r.landings, 0);
                return (
                  <div key={vendor} className="flex flex-col gap-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <h3 className="text-2xl font-extrabold! tracking-tight text-ink sm:text-3xl">
                        {names[vendor] ?? vendor.charAt(0).toUpperCase() + vendor.slice(1)}
                      </h3>
                      <span className="label tabular">
                        {list.length} {list.length === 1 ? "route" : "routes"} · {num(landings)} landings
                      </span>
                    </div>
                    <div className="grid gap-5 lg:grid-cols-2">
                      {list.map((r) => (
                        <RouteCard key={r.id} route={r} />
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </section>
        </>
      )}
    </div>
  );
}
