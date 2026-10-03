import { hash01 } from "@/lib/format";
import type { Rating } from "@/lib/airworthiness";
import type { FeedSignal, FeedRescue, Site, VendorStats } from "@/lib/types";

// Scope geometry. Everything is laid out in a 1000 x 1000 box so the SVG and
// the HTML blip layer on top of it can share coordinates (x / 10 = percent).

export const VIEW = 1000;
export const C = VIEW / 2;
export const R = 428; // outer range ring
const INNER = 64; // keep blips off the centre
const OUTER = R - 38; // and off the rim ticks

export type Snapshot = {
  vendors: VendorStats[];
  sites: Site[];
  maydays: FeedSignal[];
  rescues: FeedRescue[];
  // Airworthiness per vendor slug. The map API sends it; older snapshots may not.
  ratings?: Record<string, Rating>;
};

export type Sector = {
  slug: string;
  name: string;
  color: string;
  start: number;
  end: number;
  mid: number;
};

export type Blip = {
  site: Site;
  x: number;
  y: number;
  r: number;
  rate: number; // 0..1 share of stop signals rescued
  color: string;
};

export type PulseKind = "mayday" | "rescue";
export type Pulse = { key: string; siteId: string; kind: PulseKind };

export function polar(angle: number, radius: number) {
  return { x: C + Math.cos(angle) * radius, y: C + Math.sin(angle) * radius };
}

// One equal sector per vendor, starting at twelve o'clock and going clockwise.
export function sectorsFor(vendors: Pick<VendorStats, "slug" | "name" | "color">[]): Sector[] {
  const n = vendors.length;
  if (!n) return [];
  const span = (Math.PI * 2) / n;
  return vendors.map((v, i) => {
    const start = i * span - Math.PI / 2;
    return { slug: v.slug, name: v.name, color: v.color, start, end: start + span, mid: start + span / 2 };
  });
}

const f = (n: number) => n.toFixed(2);

export function arcPath(start: number, end: number, radius: number, reverse = false): string {
  // A full circle cannot be drawn as one arc, so stop just short of it.
  const stop = Math.min(end, start + Math.PI * 2 - 0.002);
  const a = polar(reverse ? stop : start, radius);
  const b = polar(reverse ? start : stop, radius);
  const large = stop - start > Math.PI ? 1 : 0;
  return `M ${f(a.x)} ${f(a.y)} A ${radius} ${radius} 0 ${large} ${reverse ? 0 : 1} ${f(b.x)} ${f(b.y)}`;
}

export function wedgePath(start: number, end: number, radius: number): string {
  const stop = Math.min(end, start + Math.PI * 2 - 0.002);
  const a = polar(start, radius);
  const b = polar(stop, radius);
  const large = stop - start > Math.PI ? 1 : 0;
  return `M ${C} ${C} L ${f(a.x)} ${f(a.y)} A ${radius} ${radius} 0 ${large} 1 ${f(b.x)} ${f(b.y)} Z`;
}

// The data colour of a crash site. Red when nobody has been rescued here,
// through honey at half, to blue when nearly every agent gets through. Mixed
// in oklab so the midpoints stay clean on a projector. The three ends are the
// theme's data tokens (the hive map makes Tailwind emit them as variables), so
// the ramp follows the theme.
const RED = "var(--color-distress)";
const AMBER = "var(--color-flare)";
const BLUE = "var(--color-rescue)";

export function blipColor(rate: number): string {
  const t = Math.min(1, Math.max(0, rate));
  if (t <= 0.5) return `color-mix(in oklab, ${AMBER} ${Math.round(t * 200)}%, ${RED})`;
  return `color-mix(in oklab, ${BLUE} ${Math.round((t - 0.5) * 200)}%, ${AMBER})`;
}

export function siteRate(site: Pick<Site, "maydays_count" | "rescues_count">): number {
  if (!site.maydays_count) return 0;
  return Math.min(1, site.rescues_count / site.maydays_count);
}

// Deterministic placement: the slug decides angle and range inside the vendor
// sector. A few salted candidates are tried so big blips do not sit on top of
// each other, and the result is the same on the server and in the browser.
export function placeBlips(sites: Site[], sectors: Sector[]): Blip[] {
  const bySlug = new Map(sectors.map((s) => [s.slug, s]));
  const max = Math.max(1, ...sites.map((s) => s.maydays_count));
  const ordered = [...sites].sort((a, b) => b.maydays_count - a.maydays_count || a.slug.localeCompare(b.slug));
  const placed: Blip[] = [];

  for (const site of ordered) {
    const sector = bySlug.get(site.vendor);
    if (!sector) continue;
    const span = sector.end - sector.start;
    const pad = Math.min(span * 0.14, 0.11);
    const r = 8 + 18 * Math.sqrt(site.maydays_count / max);

    let best: { x: number; y: number } | null = null;
    let bestGap = -Infinity;
    for (let k = 0; k < 10; k++) {
      const angle = sector.start + pad + hash01(site.slug, k * 2) * (span - pad * 2);
      const range = INNER + r + Math.sqrt(hash01(site.slug, k * 2 + 1)) * (OUTER - INNER - r * 2);
      const p = polar(angle, range);
      let gap = Infinity;
      for (const o of placed) {
        gap = Math.min(gap, Math.hypot(o.x - p.x, o.y - p.y) - o.r - r);
      }
      if (gap > bestGap) {
        bestGap = gap;
        best = p;
      }
      if (gap > 6) break;
    }
    if (!best) continue;
    const rate = siteRate(site);
    placed.push({ site, x: best.x, y: best.y, r, rate, color: blipColor(rate) });
  }
  return placed;
}
