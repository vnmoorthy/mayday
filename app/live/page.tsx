import type { Metadata } from "next";
import { getFlightStats, getFlights, getRoutes } from "@/lib/data";
import type { Flight, FlightStat } from "@/lib/types";
import { FLIGHT_SCENARIO } from "@/components/live/instructions";
import { LiveFlight } from "@/components/live/live-flight";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Live flight — Pioneer",
  description: "A real model flying an API it has never seen, alone and with the hive.",
};

export default async function LivePage() {
  let stats: FlightStat[] = [];
  let flights: Flight[] = [];
  let hasRoute: boolean | null = null;
  try {
    const [s, f] = await Promise.all([getFlightStats(FLIGHT_SCENARIO), getFlights(FLIGHT_SCENARIO, 12)]);
    stats = s;
    flights = f.map((x) => ({ ...x, events: [] }));
  } catch {
    // the client refreshes the scoreboard itself
  }
  try {
    hasRoute = (await getRoutes("hivepay")).length > 0;
  } catch {
    hasRoute = null;
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-5 pb-20 sm:px-8">
      {/* Kept short on purpose: on a projector both terminals and both counters fit on the first screen. */}
      <header className="mt-6">
        <span className="label">Live flight</span>
        <h1 className="mt-2 text-3xl font-extrabold! tracking-tight text-ink sm:text-4xl xl:text-5xl">
          Watch a real agent fly an API no model has seen.
        </h1>
        <p className="mt-2 max-w-5xl text-base text-ink/80 sm:text-lg">
          HivePay is fictional, its docs are out of date, and the model on screen is Gemini calling real tools; nothing is scripted.
        </p>
      </header>
      <LiveFlight initialStats={stats} initialFlights={flights} initialHasRoute={hasRoute} />
    </div>
  );
}
