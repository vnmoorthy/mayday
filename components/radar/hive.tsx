"use client";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { motion, useReducedMotion } from "framer-motion";
import { rescueRate } from "@/lib/format";
import { HEX, NEIGHBOURS, centre, f, hexPoints, type Cell, type Cluster, type Comb } from "./comb";
import type { Pulse } from "./geometry";

// The hive map: one honeycomb per vendor, one cell per crash site. Each
// cluster is its own SVG in a CSS grid, so the map wraps on narrow screens
// without any measuring, and the shared lattice makes the row read as one comb.
// A mayday pulses its cell red and ripples once through the six cells around
// it: the stop signal spreading through the hive.

// Every cell is drawn as a real wax cell: a lit rim, a recessed well, honey
// pooled inside it (more honey, more agents down), a red glow when agents are
// going down unrescued, and a pale wax cap once the site is mostly rescued.
// All gradients live in one shared <defs> block and are referenced by id, so
// the whole comb costs no per-cell filters.

const PULSE_COLOR = { mayday: "var(--color-distress)", rescue: "var(--color-rescue)" } as const;
// A rescue flashes the cell in pale wax: the cap going on.
const FLASH_COLOR = { mayday: "var(--color-distress)", rescue: "var(--color-comb)" } as const;
const INK = "var(--color-ink)";
const TIP_WIDTH = 256;

// Cell anatomy, as shares of the cell radius.
const RIM = HEX * 0.965;
const WELL = HEX * 0.8;
const POOL_MIN = HEX * 0.3;
const POOL_MAX = HEX * 0.77;
// Below this rescue rate a cell glows red; from CAP_FROM up it starts to be capped.
const RED_BELOW = 0.34;
const CAP_FROM = 0.5;

// cell.fill runs 0.2..0.88 (see comb.ts); the honey pool maps it onto the well.
function poolSize(fill: number): number {
  const t = Math.min(1, Math.max(0, (fill - 0.2) / 0.68));
  return POOL_MIN + (POOL_MAX - POOL_MIN) * t;
}

// Shared paint for every cell on the map. Rendered once; ids are document-wide.
function HiveDefs() {
  return (
    <svg width="0" height="0" className="pointer-events-none absolute" aria-hidden focusable="false">
      <defs>
        <linearGradient id="hive-rim" x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#fff3a8" />
          <stop offset="0.45" stopColor="#f2c63a" />
          <stop offset="1" stopColor="#b98900" />
        </linearGradient>
        {/* The well is lit the other way round, which is what makes it read as a hollow. */}
        <linearGradient id="hive-well" x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#4a2800" />
          <stop offset="0.5" stopColor="#8a5200" />
          <stop offset="1" stopColor="#c98a12" />
        </linearGradient>
        <linearGradient id="hive-well-red" x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#3d0410" />
          <stop offset="0.55" stopColor="#7a0a1c" />
          <stop offset="1" stopColor="#b3122a" />
        </linearGradient>
        <radialGradient id="hive-honey" cx="0.36" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#ffd76a" />
          <stop offset="0.5" stopColor="#e79a12" />
          <stop offset="1" stopColor="#8a4b00" />
        </radialGradient>
        <radialGradient id="hive-red" cx="0.36" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#ff7a7a" />
          <stop offset="0.5" stopColor="#c8102e" />
          <stop offset="1" stopColor="#6d0718" />
        </radialGradient>
        <radialGradient id="hive-red-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.35" stopColor="#ff3b4e" stopOpacity="0.75" />
          <stop offset="0.7" stopColor="#c8102e" stopOpacity="0.32" />
          <stop offset="1" stopColor="#c8102e" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hive-cap" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#fff6c2" />
          <stop offset="1" stopColor="#f1dc8a" />
        </linearGradient>
        {/* The dimple a bee leaves in a finished cap. */}
        <radialGradient id="hive-dimple" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#c9a63c" stopOpacity="0.55" />
          <stop offset="0.6" stopColor="#e3c867" stopOpacity="0.3" />
          <stop offset="1" stopColor="#f1dc8a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hive-glint" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.25" />
        </linearGradient>
        {/* One soft shadow for a whole cluster of cells, not one per cell. */}
        <filter id="hive-shadow" x="-10%" y="-10%" width="120%" height="130%" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="1.6" stdDeviation="1.4" floodColor="#4a2b00" floodOpacity="0.45" />
        </filter>
      </defs>
    </svg>
  );
}

type Tip = { id: string; x: number; top: number; bottom: number; width: number; above: boolean };

type Props = {
  comb: Comb;
  pulses: Pulse[];
  // Crash sites with an official fix pinned, per vendor slug.
  fixes: Record<string, number>;
  activeVendor: string | null;
  openSiteId: string | null;
  onToggleVendor: (slug: string) => void;
  onOpenSite: (siteId: string) => void;
};

export function Hive({ comb, pulses, fixes, activeVendor, openSiteId, onToggleVendor, onOpenSite }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const reduced = useReducedMotion() ?? false;

  const byId = useMemo(() => {
    const m = new Map<string, { cell: Cell; vendor: string }>();
    for (const c of comb.clusters) for (const cell of c.cells) m.set(cell.site.id, { cell, vendor: c.name });
    return m;
  }, [comb]);

  // The tooltip is HTML over the grid, so it is placed from the cell's box on screen.
  const show = useCallback((id: string, el: Element) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const a = el.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    setTip({
      id,
      x: a.left + a.width / 2 - w.left,
      top: a.top - w.top,
      bottom: a.bottom - w.top,
      width: w.width,
      above: a.top > 200,
    });
  }, []);
  const hide = useCallback((id: string) => setTip((t) => (t && t.id === id ? null : t)), []);

  const hover = tip ? byId.get(tip.id) : undefined;
  const hoverId = hover ? hover.cell.site.id : null;

  return (
    <div
      ref={wrapRef}
      // The arbitrary properties are here so Tailwind emits the data colours
      // as CSS variables; the SVG and the colour ramp read them.
      className="@container relative select-none overflow-x-clip [--hive-down:var(--color-distress)] [--hive-ink:var(--color-ink)] [--hive-mid:var(--color-flare)] [--hive-up:var(--color-rescue)]"
    >
      <HiveDefs />
      {/* The well the comb sits in: deep amber, with real comb showing faintly through. Its own
          layer, so the tooltip and the pulse rings are never clipped by the rounded corners. */}
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl border border-ink/15 bg-[#eab40a] shadow-[inset_0_3px_22px_rgba(84,48,0,0.38),inset_0_-2px_10px_rgba(255,246,194,0.5)]"
        aria-hidden
      >
        <img
          src="/art/comb.jpg"
          alt=""
          width={1376}
          height={768}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover opacity-[0.18]"
        />
      </div>
      <div className="relative grid grid-cols-1 px-2 pb-4 pt-3 @xs:grid-cols-2 @3xl:grid-cols-4 sm:px-4 sm:pb-6">
        {comb.clusters.map((c) => (
          <ClusterView
            key={c.slug}
            cluster={c}
            width={comb.width}
            height={comb.height}
            lattice={comb.lattice}
            pulses={pulses}
            fixes={fixes[c.slug] ?? 0}
            active={activeVendor === c.slug}
            dim={activeVendor !== null && activeVendor !== c.slug}
            hoverId={hoverId}
            openSiteId={openSiteId}
            reduced={reduced}
            onToggleVendor={onToggleVendor}
            onOpenSite={onOpenSite}
            onShow={show}
            onHide={hide}
          />
        ))}
      </div>

      {tip && hover ? <Tooltip tip={tip} cell={hover.cell} vendor={hover.vendor} /> : null}

      {byId.size === 0 ? (
        <div className={clsx("flex items-center justify-center p-6", comb.clusters.length ? "absolute inset-0" : "min-h-64")}>
          <div className="max-w-xs rounded-2xl border border-ink/15 bg-panel px-6 py-5 text-center">
            <span className="label">Quiet hive</span>
            <p className="mt-2 text-lg leading-snug text-ink">No crash sites charted yet</p>
            <p className="mt-2 text-sm leading-relaxed text-mute">
              The first mayday fills a cell on the hive map.{" "}
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

type ClusterProps = {
  cluster: Cluster;
  width: number;
  height: number;
  lattice: string;
  pulses: Pulse[];
  fixes: number;
  active: boolean;
  dim: boolean;
  hoverId: string | null;
  openSiteId: string | null;
  reduced: boolean;
  onToggleVendor: (slug: string) => void;
  onOpenSite: (siteId: string) => void;
  onShow: (id: string, el: Element) => void;
  onHide: (id: string) => void;
};

const ClusterView = memo(function ClusterView({
  cluster,
  width,
  height,
  lattice,
  pulses,
  fixes,
  active,
  dim,
  hoverId,
  openSiteId,
  reduced,
  onToggleVendor,
  onOpenSite,
  onShow,
  onHide,
}: ClusterProps) {
  const cells = cluster.cells;
  const byId = useMemo(() => new Map(cells.map((c) => [c.site.id, c])), [cells]);
  const clip = `comb-clip-${cluster.slug}`;
  const lifted = [openSiteId, hoverId].flatMap((id) => (id && byId.has(id) ? [byId.get(id)!] : []));

  return (
    // Bottom-aligned, so the combs in a row line up even when one caption wraps.
    <div className="flex min-w-0 flex-col justify-end">
      {/* Vendor identity: a square swatch, the name, how many sites. Selecting it highlights the cluster. */}
      <button
        type="button"
        aria-pressed={active}
        title={active ? "Clear highlight" : `Highlight ${cluster.name} on the hive map`}
        onClick={() => onToggleVendor(cluster.slug)}
        className={clsx(
          "flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 self-center px-2 py-2 font-mono text-[11px] uppercase tracking-[0.16em] transition-opacity duration-300",
          "focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ink",
          dim && "opacity-40",
        )}
      >
        <span className="flex items-center gap-2.5">
          <span className="h-2 w-2 shrink-0 rounded-full ring-1 ring-ink/30" style={{ background: cluster.color }} aria-hidden />
          <span className={clsx("font-semibold text-ink transition-opacity", active ? "opacity-100" : "opacity-80")}>{cluster.name}</span>
        </span>
        <span className="tabular text-ink/70">
          {cells.length} {cells.length === 1 ? "site" : "sites"}
        </span>
        {fixes > 0 ? (
          <span className="tabular text-flare">
            {fixes} official {fixes === 1 ? "fix" : "fixes"}
          </span>
        ) : null}
      </button>

      <svg
        viewBox={`${f(-width / 2)} ${f(-height / 2)} ${f(width)} ${f(height)}`}
        className="block h-auto w-full overflow-visible"
        role="group"
        aria-label={`${cluster.name}: ${cells.length} crash ${cells.length === 1 ? "site" : "sites"}`}
      >
        <defs>
          <clipPath id={clip}>
            <rect x={f(-width / 2)} y={f(-height / 2)} width={f(width)} height={f(height)} />
          </clipPath>
        </defs>

        {/* The empty comb. Clipped to the box so it meets the next cluster's comb edge to edge. */}
        <g clipPath={`url(#${clip})`} pointerEvents="none">
          {/* Soft wax walls: a broad pale ridge with a thin shaded edge under it. */}
          <path d={lattice} fill="#d99a06" fillOpacity="0.16" stroke="#9a6a00" strokeOpacity="0.3" strokeWidth="4.6" strokeLinejoin="round" />
          <path d={lattice} fill="none" stroke="#fff1a0" strokeOpacity="0.62" strokeWidth="2.6" strokeLinejoin="round" />
        </g>

        <g className="transition-opacity duration-300" style={{ opacity: dim ? 0.2 : 1 }} filter="url(#hive-shadow)">
          {cells.map((cell) => {
            const { site } = cell;
            const pool = poolSize(cell.fill);
            const red = site.maydays_count > 0 && cell.rate < RED_BELOW;
            // The cap grows over the honey as the rescue rate climbs from half to all.
            const capT = cell.rate >= CAP_FROM ? (cell.rate - CAP_FROM) / (1 - CAP_FROM) : -1;
            const cap = capT >= 0 ? pool * (0.52 + 0.5 * capT) : 0;
            return (
              <g
                key={site.id}
                role="button"
                tabIndex={0}
                aria-label={`${site.title}. ${cluster.name}, ${site.surface}. ${site.maydays_count} agents down, ${rescueRate(site.maydays_count, site.rescues_count)}% rescued. Open summary.`}
                className="cursor-pointer outline-none"
                onMouseEnter={(e) => onShow(site.id, e.currentTarget)}
                onMouseLeave={() => onHide(site.id)}
                onFocus={(e) => onShow(site.id, e.currentTarget)}
                onBlur={() => onHide(site.id)}
                onClick={() => onOpenSite(site.id)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault();
                  onOpenSite(site.id);
                }}
              >
                {/* Agents going down unrescued: the cell glows red from within, past its own walls. */}
                {red ? <circle cx={f(cell.x)} cy={f(cell.y)} r={f(HEX * 1.28)} fill="url(#hive-red-glow)" /> : null}
                {/* The wax rim, lit from the top left. */}
                <polygon points={hexPoints(cell.x, cell.y, RIM)} fill="url(#hive-rim)" stroke="#8a6400" strokeOpacity="0.55" strokeWidth="0.6" />
                {/* The well: shaded the opposite way, so it reads as a hollow. */}
                <polygon
                  points={hexPoints(cell.x, cell.y, WELL)}
                  fill={red ? "url(#hive-well-red)" : "url(#hive-well)"}
                  stroke="#3a2000"
                  strokeOpacity="0.5"
                  strokeWidth="0.8"
                />
                {/* Honey in the well. How full it is: agents down, against the largest site on the map. */}
                <polygon
                  points={hexPoints(cell.x, cell.y, pool)}
                  fill={red ? "url(#hive-red)" : "url(#hive-honey)"}
                  stroke={red ? "#ffb0b0" : "#ffe9a0"}
                  strokeOpacity="0.45"
                  strokeWidth="0.5"
                  strokeLinejoin="round"
                />
                {/* Specular glint on the surface of the honey. */}
                <ellipse
                  cx={f(cell.x - pool * 0.3)}
                  cy={f(cell.y - pool * 0.4)}
                  rx={f(pool * 0.24)}
                  ry={f(pool * 0.1)}
                  transform={`rotate(-30 ${f(cell.x - pool * 0.3)} ${f(cell.y - pool * 0.4)})`}
                  fill="url(#hive-glint)"
                />
                {/* The pale wax cap: bees cap a finished cell, and a rescued site is a finished one. */}
                {cap > 0 ? (
                  <>
                    <polygon
                      points={hexPoints(cell.x, cell.y, cap)}
                      fill="url(#hive-cap)"
                      fillOpacity="0.96"
                      stroke="#b79a3a"
                      strokeOpacity="0.6"
                      strokeWidth="0.6"
                      strokeLinejoin="round"
                    />
                    <ellipse cx={f(cell.x + cap * 0.08)} cy={f(cell.y + cap * 0.1)} rx={f(cap * 0.42)} ry={f(cap * 0.36)} fill="url(#hive-dimple)" />
                    <ellipse
                      cx={f(cell.x - cap * 0.34)}
                      cy={f(cell.y - cap * 0.42)}
                      rx={f(cap * 0.2)}
                      ry={f(cap * 0.07)}
                      transform={`rotate(-30 ${f(cell.x - cap * 0.34)} ${f(cell.y - cap * 0.42)})`}
                      fill="#ffffff"
                      fillOpacity="0.7"
                    />
                  </>
                ) : null}
              </g>
            );
          })}
        </g>

        {/* Fresh traffic: red rings and a red flash for a mayday, a pale wax cap flash for a rescue. */}
        {pulses.map((p) => {
          const cell = byId.get(p.siteId);
          if (!cell) return null;
          const color = PULSE_COLOR[p.kind];
          const flash = FLASH_COLOR[p.kind];
          const around = NEIGHBOURS.map((d) => centre(cell.q + d.q, cell.r + d.r));
          if (reduced) {
            return (
              <g key={p.key} pointerEvents="none" style={{ color }}>
                {around.map((n, i) => (
                  <polygon
                    key={i}
                    points={hexPoints(n.x, n.y)}
                    fill="none"
                    stroke="currentColor"
                    strokeOpacity="0.4"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                <polygon
                  points={hexPoints(cell.x, cell.y)}
                  fill={flash}
                  fillOpacity="0.6"
                  stroke="currentColor"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          }
          return (
            <g key={p.key} pointerEvents="none" style={{ color }}>
              {/* The stop signal: one ripple through the six cells around it. */}
              {around.map((n, i) => (
                <motion.polygon
                  key={i}
                  points={hexPoints(n.x, n.y)}
                  fill={flash}
                  stroke="currentColor"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, p.kind === "mayday" ? 0.42 : 0.7, 0] }}
                  transition={{ duration: 1.5, delay: 0.3, times: [0, 0.3, 1], ease: "easeOut" }}
                />
              ))}
              <motion.polygon
                points={hexPoints(cell.x, cell.y)}
                fill={flash}
                stroke="currentColor"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
                initial={{ opacity: 0.95 }}
                animate={{ opacity: 0 }}
                transition={{ duration: 1.6, ease: "easeOut" }}
              />
              <g transform={`translate(${f(cell.x)} ${f(cell.y)})`}>
                {[0, 0.4].map((delay) => (
                  <motion.polygon
                    key={delay}
                    points={hexPoints(0, 0)}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    vectorEffect="non-scaling-stroke"
                    initial={{ scale: 1, opacity: 0.95 }}
                    animate={{ scale: p.kind === "mayday" ? 2.6 : 2, opacity: 0 }}
                    transition={{ duration: 2, ease: "easeOut", delay }}
                  />
                ))}
              </g>
            </g>
          );
        })}

        {/* The open and the hovered cell get a solid wall, drawn last so neighbours never cover it. */}
        {lifted.map((cell, i) => (
          <polygon
            key={`${cell.site.id}-${i}`}
            points={hexPoints(cell.x, cell.y)}
            fill="none"
            style={{ stroke: INK }}
            strokeWidth={cell.site.id === openSiteId ? 2.5 : 1.5}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        ))}
      </svg>
    </div>
  );
});

function Tooltip({ tip, cell, vendor }: { tip: Tip; cell: Cell; vendor: string }) {
  const { site } = cell;
  // Centred on the cell, then held inside the map so it never leaves the page.
  const width = Math.min(TIP_WIDTH, tip.width);
  const left = Math.min(Math.max(tip.x - width / 2, 0), Math.max(0, tip.width - width));
  const rate = rescueRate(site.maydays_count, site.rescues_count);
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-20 rounded-2xl border border-ink/15 bg-panel px-3.5 py-3 shadow-[0_10px_30px_rgba(60,36,0,0.28)]"
      style={{
        left,
        width,
        top: tip.above ? tip.top - 10 : tip.bottom + 10,
        transform: tip.above ? "translateY(-100%)" : undefined,
      }}
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
          <span className="h-1.5 w-1.5 rounded-full border border-ink/40 bg-comb" aria-hidden />
          {rate}% rescued
        </span>
      </div>
    </div>
  );
}
