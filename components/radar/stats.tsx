"use client";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useReducedMotion } from "framer-motion";
import { rescueRate } from "@/lib/format";

// The five instrument readouts under the hero: one open row, divided by
// hairlines. Values tween when they change so a new mayday is visible from the
// back of the room.

function useTween(value: number): number {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const current = useRef(value);

  useEffect(() => {
    const from = current.current;
    if (from === value) return;
    // Reduced motion: land on the new value in a single frame.
    const duration = reduced ? 0 : 700;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = duration ? Math.min(1, Math.max(0, (t - t0) / duration)) : 1;
      const eased = 1 - Math.pow(1 - p, 3);
      const v = from + (value - from) * eased;
      current.current = v;
      setDisplay(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);

  return display;
}

// Colour marks the data kind only: red for maydays, near-black for rescues, burnt honey for time saved.
type Mark = "distress" | "rescue" | "flare" | null;

// Two columns on a phone (the fifth figure spans both), five in a row on
// desktop. Each cell draws only the hairlines that separate it from its neighbours.
const CELL = [
  "pr-4 lg:pr-6",
  "border-l pl-4 lg:px-6",
  "border-t pr-4 lg:border-l lg:border-t-0 lg:px-6",
  "border-l border-t pl-4 lg:border-t-0 lg:px-6",
  "col-span-2 border-t lg:col-span-1 lg:border-l lg:border-t-0 lg:pl-6",
];

function Readout({
  index,
  label,
  value,
  format,
  mark,
  hint,
}: {
  index: number;
  label: string;
  value: number;
  format: (v: number) => string;
  mark: Mark;
  hint: string;
}) {
  const shown = useTween(value);
  // Dim briefly while the number is moving, so the change reads as a tick.
  const moving = Math.abs(shown - value) > 0.001;
  return (
    <div className={clsx("flex min-w-0 flex-col gap-4 border-ink/15 py-7 sm:py-9", CELL[index])}>
      <span className="label flex items-center gap-2">
        {mark ? (
          <span
            className={clsx("hex h-2.5 w-[9px] shrink-0", mark === "distress" ? "bg-distress" : mark === "flare" ? "bg-flare" : "bg-rescue")}
            aria-hidden
          />
        ) : null}
        {label}
      </span>
      <span
        className={clsx(
          "tabular text-[2.75rem] font-extrabold leading-none tracking-[-0.05em] transition-opacity duration-300 sm:text-6xl lg:text-5xl xl:text-6xl",
          mark === "distress" ? "text-distress" : mark === "flare" ? "text-flare" : "text-ink",
          moving && "opacity-70",
        )}
        aria-live="polite"
      >
        {format(shown)}
      </span>
      <span className="text-xs leading-snug text-mute">{hint}</span>
    </div>
  );
}

const whole = (v: number) => Math.round(v).toLocaleString("en-US");

function hours(v: number): string {
  const h = v / 60;
  return h < 100 ? h.toFixed(1) : Math.round(h).toLocaleString("en-US");
}

export function StatStrip({
  maydays,
  rescues,
  minutes,
  saved,
  sites,
}: {
  maydays: number;
  rescues: number;
  minutes: number;
  // Minutes the hive saved: what rescued agents did not have to burn again.
  saved: number;
  sites: number;
}) {
  return (
    <section aria-label="Hive map totals" className="grid grid-cols-2 lg:grid-cols-5">
      <Readout
        index={0}
        label="Agents down"
        value={maydays}
        format={whole}
        mark="distress"
        hint={`maydays across ${sites.toLocaleString("en-US")} crash ${sites === 1 ? "site" : "sites"}`}
      />
      <Readout index={1} label="Rescued" value={rescues} format={whole} mark="rescue" hint="agents a flare got back in the air" />
      <Readout
        index={2}
        label="Rescue rate"
        value={rescueRate(maydays, rescues)}
        format={(v) => `${Math.round(v)}%`}
        mark={null}
        hint="rescues per mayday"
      />
      <Readout index={3} label="Agent-hours lost" value={minutes} format={hours} mark={null} hint="time agents burned before help" />
      <Readout index={4} label="Agent-hours saved" value={saved} format={hours} mark="flare" hint="time the hive gave back with a fix" />
    </section>
  );
}
