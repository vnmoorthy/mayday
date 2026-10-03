import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Become a bee — Mayday",
  description: "One tap: fly into a real failure, get the fix the hive already found, and light up the big screen.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f6cf1b",
};

// Audience mode is a single focused screen on a phone. Like the deck, this
// layer sits on top of the site nav and the swarm and scrolls on its own.
export default function JoinLayout({ children }: { children: ReactNode }) {
  return <div className="fixed inset-0 z-50 overflow-y-auto overflow-x-hidden bg-bg">{children}</div>;
}
