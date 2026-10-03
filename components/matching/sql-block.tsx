"use client";

import { useState } from "react";
import clsx from "clsx";
import { TCAP, TSCROLL, TSELECT } from "@/components/cockpit/theme";

// The SQL, verbatim, in the dark well, with a copy button.
export function SqlBlock({ sql, caption }: { sql: string; caption: string }) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(sql);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
    window.setTimeout(() => setCopied("idle"), 1800);
  }

  return (
    <div className={clsx("terminal overflow-hidden", TSELECT)}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-comb/15 px-4 py-3 sm:px-5">
        <span className={clsx(TCAP, "min-w-0 break-all")}>{caption}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="shrink-0 rounded-full border border-comb/50 px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-comb transition-colors hover:bg-comb hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-comb"
        >
          <span aria-live="polite">{copied === "copied" ? "Copied" : copied === "failed" ? "Select and copy" : "Copy SQL"}</span>
        </button>
      </div>
      <pre className={clsx("overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-relaxed text-comb sm:px-5 sm:text-[13px]", TSCROLL)}>
        <code>{sql}</code>
      </pre>
    </div>
  );
}
