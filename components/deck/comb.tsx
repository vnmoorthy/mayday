"use client";

import { motion } from "framer-motion";
import type { CSSProperties } from "react";

// A honeycomb whose cells are driven by state. Pointy-top hexagons in an
// odd-row-offset grid, drawn as one SVG so it scales with the stage.

export type CellState = "idle" | "hit" | "honey" | "wax";

// The deck palette: a honey-yellow field and near-black type. Red is a mayday,
// burnt honey is a fix, and a rescued cell is capped in pale wax with a dark
// outline.
export const DECK_COLORS = {
  field: "#f6cf1b",
  panel: "#f9db4a",
  red: "#b80f26",
  honey: "#7a3f00",
  wax: "#fff6c2",
  ink: "#17130d",
  mute: "#54491a",
  line: "#b8960a",
  dim: "#86761f",
} as const;

const FILL: Record<CellState, string> = {
  idle: DECK_COLORS.panel,
  hit: DECK_COLORS.red,
  honey: DECK_COLORS.honey,
  wax: DECK_COLORS.wax,
};

const STROKE: Record<CellState, string> = {
  idle: DECK_COLORS.line,
  hit: DECK_COLORS.red,
  honey: DECK_COLORS.honey,
  wax: DECK_COLORS.ink,
};

export function combSize(cols: number, rows: number, r: number) {
  const w = Math.sqrt(3) * r;
  return { width: cols * w + w / 2, height: rows * 1.5 * r + r / 2 };
}

export function cellCenter(col: number, row: number, r: number) {
  const w = Math.sqrt(3) * r;
  return { x: w / 2 + col * w + (row % 2 ? w / 2 : 0), y: r + row * 1.5 * r };
}

export function hexPath(cx: number, cy: number, r: number) {
  let d = "";
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 180) * (60 * k - 90);
    d += `${k === 0 ? "M" : "L"}${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  }
  return d + "Z";
}

// Distance in cells between two cells of the offset grid (via cube coords).
export function hexDist(c1: number, r1: number, c2: number, r2: number) {
  const x1 = c1 - (r1 - (r1 & 1)) / 2;
  const x2 = c2 - (r2 - (r2 & 1)) / 2;
  const dx = x1 - x2;
  const dz = r1 - r2;
  const dy = -dx - dz;
  return Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
}

export function Comb({
  cols,
  rows,
  r = 40,
  inset = 4,
  state,
  fillOpacity = 0.96,
  strokeOpacity = 1,
  duration = 0.45,
  className,
  style,
}: {
  cols: number;
  rows: number;
  r?: number;
  inset?: number;
  state: (col: number, row: number) => CellState;
  fillOpacity?: number;
  strokeOpacity?: number;
  duration?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const { width, height } = combSize(cols, rows, r);
  const cells = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const s = state(col, row);
      const { x, y } = cellCenter(col, row, r);
      cells.push(
        <motion.path
          key={`${col}-${row}`}
          d={hexPath(x, y, r - inset)}
          strokeWidth={2}
          strokeLinejoin="round"
          initial={false}
          animate={{
            fill: FILL[s],
            fillOpacity: s === "idle" ? 1 : fillOpacity,
            stroke: STROKE[s],
            strokeOpacity: s === "idle" ? 1 : strokeOpacity,
          }}
          transition={{ duration, ease: "easeOut" }}
        />,
      );
    }
  }
  return (
    <svg
      viewBox={`0 0 ${width.toFixed(1)} ${height.toFixed(1)}`}
      width={width}
      height={height}
      className={className}
      style={style}
      aria-hidden
    >
      {cells}
    </svg>
  );
}

// A single hexagon marker, used as a bullet and as a step light. A wax marker
// keeps a dark outline so it reads on the yellow field.
export function Hex({
  size = 28,
  color = DECK_COLORS.ink,
  lit = true,
  className,
}: {
  size?: number;
  color?: string;
  lit?: boolean;
  className?: string;
}) {
  const r = size / 2;
  const w = Math.sqrt(3) * r;
  const outline = color === DECK_COLORS.wax ? DECK_COLORS.ink : color;
  return (
    <svg width={w} height={size} viewBox={`0 0 ${w} ${size}`} className={className} aria-hidden>
      <motion.path
        d={hexPath(w / 2, r, r - 1.5)}
        strokeWidth={size > 60 ? 3 : 1.5}
        strokeLinejoin="round"
        initial={false}
        animate={{
          fill: lit ? color : DECK_COLORS.panel,
          stroke: lit ? outline : DECK_COLORS.line,
        }}
        transition={{ duration: 0.4 }}
      />
    </svg>
  );
}
