"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Check, Copy, X } from "lucide-react";

// Copies `text` to the clipboard and confirms it for a moment.
// `tone` says what it sits on: "dark" for a terminal well (the default, where
// every code block lives), "light" for the yellow page.
const TONE = {
  dark: {
    focus: "focus-visible:outline-comb",
    idle: "border-comb/40 text-comb/85 hover:border-comb hover:bg-comb hover:text-ink",
    copied: "border-comb bg-comb text-ink",
    failed: "border-[#ff9a8f] text-[#ff9a8f]",
  },
  light: {
    focus: "focus-visible:outline-ink",
    idle: "border-ink/40 text-ink hover:border-ink hover:bg-ink hover:text-bg",
    copied: "border-ink bg-ink text-bg",
    failed: "border-distress bg-distress/10 text-distress",
  },
} as const;

export function CopyButton({
  text,
  label = "Copy",
  tone = "dark",
  className,
}: {
  text: string;
  label?: string;
  tone?: keyof typeof TONE;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // The Clipboard API is blocked on insecure origins: fall back to a hidden textarea.
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    setState(ok ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1600);
  }

  const Icon = state === "copied" ? Check : state === "failed" ? X : Copy;

  return (
    <button
      type="button"
      onClick={copy}
      aria-live="polite"
      className={clsx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
        TONE[tone].focus,
        TONE[tone][state],
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
      {state === "copied" ? "Copied" : state === "failed" ? "Select and copy" : label}
    </button>
  );
}
