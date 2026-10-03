"use client";
import { useEffect, useState } from "react";
import { timeAgo } from "@/lib/format";

// Relative time that keeps itself current. The server and the browser render
// a few seconds apart, so the text is allowed to differ on hydration.
export function Ago({ iso, className }: { iso: string; className?: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {timeAgo(iso)}
    </time>
  );
}
