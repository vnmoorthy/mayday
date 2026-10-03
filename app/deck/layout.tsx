import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./deck.css";

export const metadata: Metadata = {
  title: "Pioneer — the stop signal for agents",
  description: "The Pioneer presentation: ten slides, about three minutes.",
};

// The deck is full-bleed. The root layout still renders the site nav, so this
// layer sits on top of it and covers the whole viewport in honey yellow.
export default function DeckLayout({ children }: { children: ReactNode }) {
  return <div className="fixed inset-0 z-50 deck-root overflow-hidden">{children}</div>;
}
