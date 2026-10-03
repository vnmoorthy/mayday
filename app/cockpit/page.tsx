import type { Metadata } from "next";
import { Cockpit } from "@/components/cockpit/cockpit";

export const metadata: Metadata = {
  title: "Cockpit · Pioneer",
  description: "Fly as an agent: send a real error to Pioneer and see exactly what an agent gets back.",
};

// The cockpit is a client console that talks to the HTTP API; it reads nothing
// from the database at render time.
export default function CockpitPage() {
  return <Cockpit />;
}
