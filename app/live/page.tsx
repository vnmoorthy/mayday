import type { Metadata } from "next";
import { getFlightStats, getFlights, getRoutes } from "@/lib/data";
import type { Flight, FlightStat } from "@/lib/types";
import { FLIGHT_SCENARIO } from "@/components/live/instructions";
import { LiveFlight } from "@/components/live/live-flight";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Live flight — Mayday",
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
      <header className="mt-8 max-w-4xl">
        <span className="label">Live flight</span>
        <h1 className="mt-3 text-4xl font-extrabold! tracking-tight text-ink sm:text-5xl lg:text-6xl">
          Watch a real agent fly an API no model has seen.
        </h1>
        <p className="mt-4 max-w-3xl text-base text-ink/80 sm:text-lg">
          HivePay is fictional, its docs are out of date, and the model on screen is Gemini calling real tools; nothing is scripted.
        </p>
      </header>
      <LiveFlight initialStats={stats} initialFlights={flights} initialHasRoute={hasRoute} />
    </div>
  );
}
