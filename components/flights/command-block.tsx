import clsx from "clsx";
import { CopyButton } from "@/components/cockpit/copy-button";
import { TCAP, TSCROLL, TSELECT } from "@/components/cockpit/theme";

// A shell command with a copy button, set in the dark terminal well. Long
// commands scroll inside the block, never the page. The "$" prompt is
// decoration: it is not selectable and is not part of what gets copied.
export function CommandBlock({ command, label, className }: { command: string; label?: string; className?: string }) {
  return (
    <div className={clsx("terminal min-w-0 overflow-hidden", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-comb/15 px-4 py-2.5">
        <span className={clsx(TCAP, "truncate")}>{label ?? "Terminal"}</span>
        <CopyButton text={command} />
      </div>
      <pre className={clsx("overflow-x-auto px-4 py-4 font-mono text-[13px] leading-relaxed text-comb", TSCROLL, TSELECT)}>
        <code>
          <span className="select-none font-semibold text-bg" aria-hidden>
            ${" "}
          </span>
          {command}
        </code>
      </pre>
    </div>
  );
}
