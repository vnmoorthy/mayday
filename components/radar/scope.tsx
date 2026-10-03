"use client";
import { memo, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { motion, useReducedMotion } from "framer-motion";
import { rescueRate } from "@/lib/format";
import { C, R, VIEW, arcPath, polar, wedgePath, type Blip, type Pulse, type Sector } from "./geometry";

// The scope itself: a static SVG (rings, sectors, ticks), a CSS-rotated sweep,
// and an HTML layer of real buttons for the blips so they are focusable and
// cheap to animate. Everything is white on black; the blips are the only colour.

const RINGS = [0.25, 0.5, 0.75, 1];
const TICKS = Array.from({ length: 72 }, (_, i) => i);
// Rounded so server and browser render the same strings.
const pct = (v: number) => `${((v / VIEW) * 100).toFixed(3)}%`;

const PULSE_COLOR = { mayday: "#ff3b30", rescue: "#58b7ff" } as const;
const MONO = "var(--font-geist-mono), ui-monospace, monospace";
// Advance of one rim-label character in em: mono glyph plus .label tracking.
const ADVANCE = 0.76;

type Props = {
  sectors: Sector[];
  blips: Blip[];
  pulses: Pulse[];
  activeVendor: string | null;
  openSiteId: string | null;
  onToggleVendor: (slug: string) => void;
  onOpenSite: (siteId: string) => void;
};

// Rings, ticks and sector outlines never change with live traffic, so they
// are memoised apart from the blips.
const Backdrop = memo(function Backdrop({
  sectors,
  activeVendor,
  onToggleVendor,
}: Pick<Props, "sectors" | "activeVendor" | "onToggleVendor">) {
  return (
    <svg viewBox={`0 0 ${VIEW} ${VIEW}`} className="absolute inset-0 h-full w-full" aria-hidden>
      {/* One wedge per vendor: a hairline outline, lifted when highlighted. */}
      {sectors.map((s) => {
        const active = activeVendor === s.slug;
        return (
          <path
            key={s.slug}
            d={wedgePath(s.start, s.end, R)}
            fill="#ffffff"
            fillOpacity={active ? 0.055 : 0}
            stroke="#ffffff"
            strokeOpacity={active ? 0.85 : 0.14}
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            className="cursor-pointer transition-[fill-opacity,stroke-opacity] duration-300"
            style={{ pointerEvents: "all" }}
            onClick={() => onToggleVendor(s.slug)}
          />
        );
      })}

      {/* Crosshair through the centre. */}
      <g stroke="#ffffff" strokeOpacity="0.08" strokeWidth="1" pointerEvents="none">
        <line x1={C - R} y1={C} x2={C + R} y2={C} vectorEffect="non-scaling-stroke" />
        <line x1={C} y1={C - R} x2={C} y2={C + R} vectorEffect="non-scaling-stroke" />
      </g>

      {RINGS.map((k) => (
        <circle
          key={k}
          cx={C}
          cy={C}
          r={R * k}
          fill="none"
          stroke="#ffffff"
          strokeOpacity={k === 1 ? 0.5 : 0.13}
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      ))}

      {/* Bearing ticks every 5 degrees, longer every 30. */}
      {TICKS.map((i) => {
        const a = (i * 5 * Math.PI) / 180 - Math.PI / 2;
        const major = i % 6 === 0;
        const p1 = polar(a, R - (major ? 14 : 7));
        const p2 = polar(a, R);
        return (
          <line
            key={i}
            x1={p1.x.toFixed(2)}
            y1={p1.y.toFixed(2)}
            x2={p2.x.toFixed(2)}
            y2={p2.y.toFixed(2)}
            stroke="#ffffff"
            strokeOpacity={major ? 0.55 : 0.22}
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        );
      })}

      {/* Vendor identity on the rim: a square swatch, then the name set like a label. */}
      {sectors.map((s) => {
        const active = activeVendor === s.slug;
        const name = s.name.toUpperCase();
        const lower = Math.sin(s.mid) > 0.05; // flip text so it reads left to right at the bottom
        const labelR = lower ? R + 36 : R + 22;
        const arcLen = (s.end - s.start) * labelR;
        const size = Math.max(11, Math.min(15, (arcLen * 0.8) / ((name.length + 3) * ADVANCE)));
        // The swatch sits just before the first letter, on the same curve.
        const half = (name.length * size * ADVANCE) / 2 / labelR;
        const lead = (size * 1.1) / labelR;
        const at = lower ? s.mid + half + lead : s.mid - half - lead;
        const side = size * 0.62;
        const p = polar(at, lower ? labelR - size * 0.36 : labelR + size * 0.36);
        const turn = (at * 180) / Math.PI + 90;
        return (
          <g key={s.slug} pointerEvents="none">
            <rect
              x={(-side / 2).toFixed(2)}
              y={(-side / 2).toFixed(2)}
              width={side.toFixed(2)}
              height={side.toFixed(2)}
              fill={s.color}
              transform={`translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${turn.toFixed(2)})`}
            />
            <path id={`rim-${s.slug}`} d={arcPath(s.start, s.end, labelR, lower)} fill="none" />
            <text
              fill="#ffffff"
              fillOpacity={active ? 1 : 0.56}
              fontSize={size.toFixed(1)}
              fontFamily={MONO}
              letterSpacing="0.16em"
              textAnchor="middle"
              className="transition-[fill-opacity] duration-300"
            >
              <textPath href={`#rim-${s.slug}`} startOffset="50%">
                {name}
              </textPath>
            </text>
          </g>
        );
      })}

      <circle cx={C} cy={C} r="3" fill="#ffffff" pointerEvents="none" />
      <circle cx={C} cy={C} r="11" fill="none" stroke="#ffffff" strokeOpacity="0.35" vectorEffect="non-scaling-stroke" pointerEvents="none" />
    </svg>
  );
});

export function Scope({ sectors, blips, pulses, activeVendor, openSiteId, onToggleVendor, onOpenSite }: Props) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const reduced = useReducedMotion();
  const byId = useMemo(() => new Map(blips.map((b) => [b.site.id, b])), [blips]);
  const vendorName = useMemo(() => new Map(sectors.map((s) => [s.slug, s.name])), [sectors]);
  const hover = hoverId ? byId.get(hoverId) : undefined;

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[min(100%,84vh)] select-none">
      <Backdrop sectors={sectors} activeVendor={activeVendor} onToggleVendor={onToggleVendor} />

      {/* The sweep: a faint white wedge rotated on the GPU, with a hairline leading edge. */}
      <div
        className="pointer-events-none absolute animate-sweep rounded-full"
        style={{
          inset: pct(C - R),
          background:
            "conic-gradient(from 0deg, rgba(255,255,255,0) 0deg, rgba(255,255,255,0) 292deg, rgba(255,255,255,0.025) 328deg, rgba(255,255,255,0.1) 360deg)",
        }}
        aria-hidden
      >
        <span className="absolute left-1/2 top-0 h-1/2 w-px -translate-x-1/2 bg-white/45" />
      </div>

      <div className="pointer-events-none absolute inset-0">
        {/* Rings for fresh traffic: red for a stop signal, blue for a rescue. */}
        {pulses.map((p) => {
          const b = byId.get(p.siteId);
          if (!b) return null;
          const color = PULSE_COLOR[p.kind];
          const base = {
            left: pct(b.x),
            top: pct(b.y),
            width: pct(b.r * 2),
            height: pct(b.r * 2),
            x: "-50%",
            y: "-50%",
          };
          if (reduced) {
            return (
              <span
                key={p.key}
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border"
                style={{ left: base.left, top: base.top, width: pct(b.r * 4), height: pct(b.r * 4), borderColor: color }}
              />
            );
          }
          return (
            <span key={p.key}>
              <motion.span
                className="absolute rounded-full"
                style={{ ...base, background: color }}
                initial={{ scale: 1, opacity: 0.85 }}
                animate={{ scale: 2.4, opacity: 0 }}
                transition={{ duration: 0.9, ease: "easeOut" }}
              />
              {[0, 0.4].map((delay) => (
                <motion.span
                  key={delay}
                  className="absolute rounded-full border"
                  style={{ ...base, borderColor: color }}
                  initial={{ scale: 1, opacity: 0.95 }}
                  animate={{ scale: p.kind === "mayday" ? 7 : 5, opacity: 0 }}
                  transition={{ duration: 2, ease: "easeOut", delay }}
                />
              ))}
            </span>
          );
        })}

        {blips.map((b) => {
          const hit = Math.max(b.r, 15);
          const dim = activeVendor !== null && activeVendor !== b.site.vendor;
          const open = openSiteId === b.site.id;
          return (
            <button
              key={b.site.id}
              type="button"
              className={clsx(
                "group pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full transition-opacity duration-300",
                "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-white",
                dim ? "opacity-20" : "opacity-100",
              )}
              style={{ left: pct(b.x), top: pct(b.y), width: pct(hit * 2), height: pct(hit * 2) }}
              aria-label={`${b.site.title}. ${vendorName.get(b.site.vendor) ?? b.site.vendor}, ${b.site.surface}. ${b.site.maydays_count} agents down, ${rescueRate(b.site.maydays_count, b.site.rescues_count)}% rescued. Open summary.`}
              onMouseEnter={() => setHoverId(b.site.id)}
              onMouseLeave={() => setHoverId((id) => (id === b.site.id ? null : id))}
              onFocus={() => setHoverId(b.site.id)}
              onBlur={() => setHoverId((id) => (id === b.site.id ? null : id))}
              onClick={() => onOpenSite(b.site.id)}
            >
              {/* Flat colour. The black edge separates neighbours; the open site gets a white ring. */}
              <span
                className="block rounded-full transition-transform duration-200 group-hover:scale-125 group-focus-visible:scale-125"
                style={{
                  width: `${((b.r / hit) * 100).toFixed(2)}%`,
                  height: `${((b.r / hit) * 100).toFixed(2)}%`,
                  background: b.color,
                  boxShadow: open ? "0 0 0 2px #000000, 0 0 0 3px #ffffff" : "0 0 0 1px #000000",
                }}
              />
            </button>
          );
        })}
      </div>

      {hover ? <Tooltip blip={hover} vendor={vendorName.get(hover.site.vendor) ?? hover.site.vendor} /> : null}

      {blips.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center p-10">
          <div className="max-w-xs bg-bg px-6 py-5 text-center">
            <span className="label">Clear skies</span>
            <p className="mt-2 text-lg leading-snug text-ink">No crash sites charted yet</p>
            <p className="mt-2 text-sm leading-relaxed text-mute">
              The first stop signal puts a blip on the scope.{" "}
              <Link href="/cockpit" className="text-ink underline decoration-line-2 underline-offset-4 hover:decoration-ink">
                Send one from the cockpit
              </Link>
              .
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Tooltip({ blip, vendor }: { blip: Blip; vendor: string }) {
  const { site } = blip;
  // Sit above or below the blip and lean toward the centre so it never leaves the scope.
  const tx = blip.x < VIEW / 3 ? "-12%" : blip.x > (VIEW * 2) / 3 ? "-88%" : "-50%";
  const ty = blip.y > C ? `calc(-100% - ${18}px)` : "18px";
  const rate = rescueRate(site.maydays_count, site.rescues_count);
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-20 w-64 max-w-[72vw] border border-line-2 bg-bg px-3.5 py-3"
      style={{ left: pct(blip.x), top: pct(blip.y), transform: `translate(${tx}, ${ty})` }}
    >
      <p className="label truncate">
        {vendor} · {site.surface}
      </p>
      <p className="mt-1.5 text-sm leading-snug text-ink">{site.title}</p>
      <div className="tabular mt-2.5 flex items-center justify-between gap-3 border-t border-line pt-2 font-mono text-xs">
        <span className="flex items-center gap-1.5 text-ink">
          <span className="h-1.5 w-1.5 bg-distress" aria-hidden />
          {site.maydays_count.toLocaleString("en-US")} {site.maydays_count === 1 ? "agent" : "agents"} down
        </span>
        <span className="flex items-center gap-1.5 text-mute">
          <span className="h-1.5 w-1.5" style={{ background: blip.color }} aria-hidden />
          {rate}% rescued
        </span>
      </div>
    </div>
  );
}
