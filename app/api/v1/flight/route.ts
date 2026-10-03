import { getFlightStats, getFlights } from "@/lib/data";
import { AIRSPACES, runFlight, type Airspace } from "@/lib/flight";
import { CORS_HEADERS, HttpError, json, limit, preflight, route } from "@/lib/http";
import { FLIGHT_SCENARIO } from "@/components/live/instructions";
import type { FlightMode } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODES: FlightMode[] = ["solo", "pioneer", "follower"];

// Flies a real model through the HivePay scenario and streams what happens as
// newline-delimited JSON: one FlightEvent per line, then { kind: "flight", flight }.
export const POST = route(async (req) => {
  const limited = await limit(req, "flight", 6);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "Invalid request. The body must be JSON.");
  }
  const mode = (body as { mode?: unknown } | null)?.mode;
  if (typeof mode !== "string" || !MODES.includes(mode as FlightMode)) {
    throw new HttpError(400, "Invalid request. mode must be solo, pioneer or follower.");
  }
  // Optional: which vendor slug the flight's Pioneer calls are filed under.
  const requested = (body as { airspace?: unknown } | null)?.airspace;
  if (requested != null && (typeof requested !== "string" || !AIRSPACES.includes(requested as Airspace))) {
    throw new HttpError(400, "Invalid request. airspace must be hivepay or hivepay-live.");
  }
  const airspace: Airspace = (requested as Airspace | undefined) ?? "hivepay";
  if (!process.env.GEMINI_API_KEY) throw new HttpError(503, "Live flights need GEMINI_API_KEY on the server.");

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: unknown) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(line) + "\n"));
        } catch {
          // the reader went away; the flight still finishes and is saved
        }
      };
      try {
        const flight = await runFlight(mode as FlightMode, send, airspace);
        send({ kind: "flight", flight });
      } catch (e) {
        send({ kind: "error", t: 0, text: e instanceof Error ? e.message : "The flight failed to start." });
      }
      try {
        controller.close();
      } catch {
        // already closed
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
});

// The scoreboard: per-mode stats and the last 12 flights (without their events).
export const GET = route(async () => {
  const [stats, flights] = await Promise.all([getFlightStats(FLIGHT_SCENARIO), getFlights(FLIGHT_SCENARIO, 12)]);
  return json({ stats, flights: flights.map((f) => ({ ...f, events: [] })) });
});

export const OPTIONS = preflight;
