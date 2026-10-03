"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Bee } from "@/components/ui";

const LINKS = [
  { href: "/", label: "Hive map" },
  { href: "/live", label: "Live flight" },
  { href: "/tower", label: "Towers" },
  { href: "/waggle", label: "Waggle" },
  { href: "/matching", label: "Matching" },
  { href: "/cockpit", label: "Cockpit" },
  { href: "/agents", label: "Agents" },
  { href: "/flights", label: "Flights" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-ink/15 bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-6 px-5 sm:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 text-ink">
          <Bee className="h-7 w-8 animate-hover-bee" />
          <span className="text-xl font-extrabold tracking-[-0.05em]">Pioneer</span>
        </Link>
        <nav className="flex items-center gap-1 overflow-x-auto">
          {LINKS.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                  active ? "bg-ink text-bg" : "text-ink/75 hover:bg-ink/10 hover:text-ink",
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <Link
          href="/install"
          className="ml-auto hidden shrink-0 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-bg transition-colors hover:bg-ink/85 md:inline-flex"
        >
          Connect your agent
        </Link>
      </div>
    </header>
  );
}
