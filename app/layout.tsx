import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Nav } from "@/components/nav";
import { Swarm } from "@/components/swarm";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pioneer — the stop signal for agents",
  description:
    "A honeybee attacked on a path warns the hive off it. Pioneer does that for agents: when one goes down on a product, the next gets the fix, and the vendor sees where agents fail.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-bg text-ink">
        {/* Spray filter for the giant wordmark: a soft, grainy edge. */}
        <svg aria-hidden="true" className="pointer-events-none absolute h-0 w-0">
          <filter id="spray" x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" result="noise" />
            <feDisplacementMap in="blur" in2="noise" scale="22" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>
        <Swarm />
        <div className="relative z-10 flex min-h-full flex-1 flex-col">
          <Nav />
          <main className="flex flex-1 flex-col">{children}</main>
        </div>
      </body>
    </html>
  );
}
