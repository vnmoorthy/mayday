import clsx from "clsx";
import { CopyButton } from "./copy-button";
import { TCAP, TSCROLL, TSELECT } from "./theme";

// A code block with its own copy button, set in the dark terminal well. Long
// lines scroll inside the block so the page never scrolls sideways.
export function Snippet({ code, label, className }: { code: string; label: string; className?: string }) {
  return (
    <div className={clsx("terminal min-w-0 overflow-hidden", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-comb/15 px-4 py-2.5">
        <span className={clsx(TCAP, "truncate")}>{label}</span>
        <CopyButton text={code} />
      </div>
      <pre className={clsx("overflow-x-auto px-4 py-4 font-mono text-[13px] leading-relaxed text-comb", TSCROLL, TSELECT)}>
        <code>{code}</code>
      </pre>
    </div>
  );
}
