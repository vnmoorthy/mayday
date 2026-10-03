import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Stage — Pioneer",
  description: "The big-screen companion to audience mode: the live hive map, session counters and the join code.",
};

// The stage is full-bleed for a projector. The root layout still renders the
// site nav and the swarm, so this layer covers both in honey yellow.
export default function StageLayout({ children }: { children: ReactNode }) {
  return <div className="fixed inset-0 z-50 overflow-hidden bg-bg">{children}</div>;
}
