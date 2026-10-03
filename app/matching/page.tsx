import type { Metadata } from "next";
import { readFile } from "node:fs/promises";
import path from "node:path";
import clsx from "clsx";
import { explainMatch, getVendorStats } from "@/lib/data";
import type { MatchExplanation } from "@/lib/types";
import { Bee } from "@/components/ui";
import { H2, HEADLINE, INLINE_CODE } from "@/components/cockpit/theme";
import { DEFAULT_ERROR } from "@/components/matching/examples";
import { MatchExplainer, type VendorOption } from "@/components/matching/explainer";
import { MATCH_SITE_MIGRATION, MATCH_SITE_SQL } from "@/components/matching/match-site-sql";
import { SqlBlock } from "@/components/matching/sql-block";

// Scores come from Postgres on every request, and ?error= is read per request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "How matching works — Mayday",
  description: "Paste an error and see every score Postgres computes to decide which crash site it belongs to.",
};

type Props = { searchParams: Promise<{ error?: string | string[]; vendor?: string | string[] }> };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

// The definition of match_site(), read from the migration that created it so
// the page cannot drift from the database. Falls back to an embedded copy when
// the file is not on disk.
async function readMatchSiteSql(): Promise<{ sql: string; fromFile: boolean }> {
  try {
    const text = await readFile(path.join(process.cwd(), "supabase", "migrations", "0003_match_by_error_code.sql"), "utf8");
    const found = text.match(/create (?:or replace )?function public\.match_site\([\s\S]*?\n\$\$;/);
    if (found) return { sql: found[0], fromFile: true };
  } catch {
    // Not on disk: use the embedded copy.
  }
  return { sql: MATCH_SITE_SQL, fromFile: false };
}

export default async function MatchingPage({ searchParams }: Props) {
  const query = await searchParams;
  const linked = first(query.error).trim().slice(0, 4000);
  const error = linked || DEFAULT_ERROR;

  let vendors: VendorOption[] = [];
  try {
    vendors = (await getVendorStats()).map((v) => ({ slug: v.slug, name: v.name })).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    // The select falls back to Auto alone; the explanation below reports the problem.
  }
  const wanted = first(query.vendor).trim().toLowerCase().slice(0, 60);
  const vendor = vendors.some((v) => v.slug === wanted) ? wanted : "";

  // Run on the server so a deep link (and the default example) arrives already explained.
  let result: MatchExplanation | null = null;
  let failure: string | null = null;
  try {
    result = await explainMatch({ error, vendor: vendor || null, limit: 6 });
  } catch (e) {
    failure = `Postgres did not answer, so there is nothing to explain yet. ${e instanceof Error ? e.message : ""}`.trim();
  }

  const { sql, fromFile } = await readMatchSiteSql();

  return (
    <div className="mx-auto w-full max-w-[1440px] px-5 pb-20 sm:px-8">
      <header className="grid gap-8 py-14 sm:py-20 lg:grid-cols-12 lg:items-end">
        <div className="lg:col-span-8">
          <span className="label inline-flex items-center gap-2">
            <Bee className="h-4 w-5 text-ink" />
            How matching works
          </span>
          <h1 className={clsx("mt-5", HEADLINE)}>One SQL function decides.</h1>
        </div>
        <p className="max-w-xl text-lg leading-relaxed text-mute lg:col-span-4">
          Every error an agent reports is scored against every crash site by one Postgres function,{" "}
          <code className={INLINE_CODE}>match_site()</code>; paste an error and see each number it computes.
        </p>
      </header>

      <MatchExplainer
        key={`${vendor}|${error}`}
        vendors={vendors}
        initialError={error}
        initialVendor={vendor}
        initialResult={result}
        initialFailure={failure}
      />

      {/* (c) The SQL itself */}
      <section aria-labelledby="the-sql" className="mt-12 flex flex-col gap-6 border-t border-ink/15 pt-12 sm:mt-16 sm:pt-16">
        <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
          <div className="flex flex-col gap-2 lg:col-span-5">
            <span className="label">Step 3</span>
            <h2 id="the-sql" className={clsx("text-3xl sm:text-4xl", H2)}>
              The function, verbatim.
            </h2>
          </div>
          <p className="max-w-3xl text-[15px] leading-relaxed text-mute lg:col-span-7">
            Agents report one failure as a full stack trace, a one-line excerpt or a reworded wrapper, so the function measures trigram overlap in
            both directions (is the charted signature inside the error, and is the error inside the signature) and lets a shared error code such
            as <code className={INLINE_CODE}>PGRST116</code> match on its own, because the code is the part that survives rewording and version
            changes. The 0.55 threshold is the trade-off: lower it and different failures merge into one crash site, so agents are handed the
            wrong fix; raise it and one failure splits across several sites, each with fewer flares, and a loose paraphrase with no shared code
            is missed.
          </p>
        </div>

        <SqlBlock sql={sql} caption={fromFile ? `${MATCH_SITE_MIGRATION} · read from disk for this request` : `${MATCH_SITE_MIGRATION} · embedded copy`} />

        <p className="max-w-3xl text-sm leading-relaxed text-mute">
          The rows above come from <code className={INLINE_CODE}>match_candidates()</code>, which computes the same four terms and returns each
          one instead of only the winner. The same numbers are available to any agent at{" "}
          <code className={INLINE_CODE}>POST /api/v1/explain</code>.
        </p>
      </section>

      {/* (d) Where it runs */}
      <p className="mt-10 rounded-2xl border border-ink bg-panel px-5 py-5 text-lg font-semibold leading-snug tracking-tight text-ink sm:px-6 sm:text-xl">
        The same function runs inside <code className={INLINE_CODE}>report_mayday()</code>, in the same transaction that counts the mayday.
      </p>
    </div>
  );
}
