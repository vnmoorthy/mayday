import { getRatings, getRecentMaydays, getRecentRescues, getSavings, getSites, getVendorStats } from "@/lib/data";
import { ButtonLink } from "@/components/ui";
import { Radar } from "@/components/radar/radar";

// The hive map reads live counts, so it is never prerendered.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  let snapshot;
  let ratings;
  let minutesSaved = 0;
  try {
    const [vendors, sites, maydays, rescues, rated, savings] = await Promise.all([
      getVendorStats(),
      getSites(),
      getRecentMaydays(40),
      getRecentRescues(20),
      getRatings(),
      // Savings are a bonus figure: without the RPC the page still renders.
      getSavings().catch(() => null),
    ]);
    snapshot = { vendors, sites, maydays, rescues };
    ratings = rated;
    minutesSaved = savings?.minutes_saved ?? 0;
  } catch (err) {
    return <NotConnected reason={err instanceof Error ? err.message : "Unknown error"} />;
  }
  return <Radar initial={snapshot} ratings={ratings} minutesSaved={minutesSaved} />;
}

// Shown when the database cannot be reached: missing env or missing schema.
const NEEDS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "supabase/migrations/0001_mayday.sql",
];

function NotConnected({ reason }: { reason: string }) {
  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col px-5 pb-16 pt-16 sm:px-8 sm:pt-24">
      <span className="label flex items-center gap-2.5">
        <span className="h-1.5 w-1.5 bg-distress" aria-hidden />
        Hive map offline
      </span>
      <h1 className="mt-6 max-w-[16ch] text-5xl text-ink sm:text-6xl lg:text-7xl">Not connected to Supabase.</h1>
      <p className="mt-8 max-w-xl text-base leading-relaxed text-mute">
        The hive map reads crash sites, stop signals and rescues from Postgres, and it could not reach the database. Set the
        three Supabase variables in <code className="font-mono text-ink">.env.local</code>, apply the migration, then
        reload.
      </p>

      <div className="mt-12 grid max-w-4xl gap-10 border-t border-line pt-8 md:grid-cols-2">
        <div>
          <span className="label">01 — What it needs</span>
          <ul className="mt-4 font-mono text-xs text-ink">
            {NEEDS.map((n) => (
              <li key={n} className="break-all border-b border-line py-2.5">
                {n}
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0">
          <span className="label">02 — What the database said</span>
          <pre className="scroll-thin mt-4 max-h-40 overflow-auto whitespace-pre-wrap break-words border-l border-distress pl-4 font-mono text-xs leading-relaxed text-distress">
            {reason}
          </pre>
        </div>
      </div>

      <div className="mt-12 flex flex-wrap gap-3">
        <ButtonLink href="/install">Connect your agent</ButtonLink>
        <ButtonLink href="/" variant="ghost">
          Try again
        </ButtonLink>
      </div>
    </div>
  );
}
