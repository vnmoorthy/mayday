import type { Metadata } from "next";
import { getAgentBreakdown, getVendorStats } from "@/lib/data";
import type { AgentRow } from "@/lib/types";
import { Bee, ButtonLink } from "@/components/ui";
import { AgentsClient, type VendorRef } from "@/components/agents/agents-client";

// Reads the breakdown from Postgres on every request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Agents and models — Pioneer",
  description: "Which coding agents and models go down, and on which vendors.",
};

export default async function AgentsPage() {
  let rows: AgentRow[] = [];
  let vendors: VendorRef[] = [];
  let dbError: string | null = null;
  try {
    const [breakdown, stats] = await Promise.all([getAgentBreakdown(), getVendorStats()]);
    rows = breakdown;
    vendors = stats.map((v) => ({ slug: v.slug, name: v.name, color: v.color }));
  } catch (err) {
    dbError = err instanceof Error ? err.message : "Unknown error";
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-5 pb-20 sm:px-8">
      <header className="grid gap-8 py-14 sm:py-20 lg:grid-cols-12 lg:items-end">
        <div className="lg:col-span-8">
          <span className="label">Agents and models</span>
          <h1 className="mt-5 text-5xl !font-extrabold tracking-tight text-ink sm:text-6xl lg:text-7xl">
            Who goes down, and where.
          </h1>
        </div>
        <div className="lg:col-span-4">
          <p className="text-[15px] leading-relaxed text-mute">
            Every stop signal names the agent that sent it and the model it was running. This page adds them up: which agents crash
            most, which vendors they crash on, and how often another agent&rsquo;s flare got them through.
          </p>
        </div>
      </header>

      {dbError ? (
        <section className="rule py-12 sm:py-16" aria-labelledby="offline-heading">
          <div className="grid gap-8 rounded-2xl border border-ink/15 bg-panel p-6 sm:p-10 lg:grid-cols-12 lg:items-center">
            <div className="lg:col-span-6">
              <Bee className="h-10 w-12 text-ink" />
              <h2 id="offline-heading" className="mt-5 text-3xl !font-bold tracking-tight text-ink sm:text-4xl">
                The hive is not connected.
              </h2>
              <p className="mt-4 max-w-md text-[15px] leading-relaxed text-mute">
                This page reads the agent breakdown straight from the database, and the database did not answer. Nothing is
                shown rather than something made up. Check the Supabase keys and that the migrations have run, then reload.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <ButtonLink href="/agents">Try again</ButtonLink>
                <ButtonLink href="/install" variant="ghost">
                  Setup guide
                </ButtonLink>
              </div>
            </div>
            <div className="lg:col-span-6">
              <span className="label">What the database said</span>
              <pre className="terminal scroll-thin mt-3 overflow-x-auto whitespace-pre-wrap break-words p-5 font-mono text-[13px] leading-relaxed text-comb">
                {dbError}
              </pre>
            </div>
          </div>
        </section>
      ) : (
        <AgentsClient rows={rows} vendors={vendors} />
      )}
    </div>
  );
}
