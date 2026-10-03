import type { Site, VendorStats } from "@/lib/types";
import { blipColor, siteRate } from "./geometry";

// Hive map geometry. Every crash site is one pointy-top hexagonal cell, and
// each vendor's cells are packed into one cluster that spirals out from the
// centre. Every cluster is drawn in the same viewBox, sized to a whole number
// of cells, so the faint lattice behind them tiles into one continuous comb
// when the clusters sit side by side.

export const HEX = 30; // centre to corner, in viewBox units
const ACROSS = Math.sqrt(3) * HEX; // flat side to flat side
const ROW = 1.5 * HEX; // distance between rows

export type Axial = { q: number; r: number };

// The six neighbours of a cell, clockwise from east.
export const NEIGHBOURS: Axial[] = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
];

export type Cell = {
  site: Site;
  q: number;
  r: number;
  x: number;
  y: number;
  rate: number; // 0..1 share of stop signals rescued
  color: string;
  fill: number; // 0..1 size of the inner hexagon: agents down against the largest site
};

export type Cluster = { slug: string; name: string; color: string; cells: Cell[] };

export type Comb = {
  clusters: Cluster[];
  width: number;
  height: number;
  lattice: string; // path for the empty comb behind every cluster
};

export function centre(q: number, r: number) {
  return { x: ACROSS * (q + r / 2), y: ROW * r };
}

// Rounded so server and browser render the same strings.
export const f = (n: number) => {
  const s = n.toFixed(2);
  return s === "-0.00" ? "0.00" : s;
};

export function hexPoints(x: number, y: number, size = HEX): string {
  let out = "";
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    out += `${i ? " " : ""}${f(x + Math.cos(a) * size)},${f(y + Math.sin(a) * size)}`;
  }
  return out;
}

const ringOf = (q: number, r: number) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));

// The first n cells of a spiral: the centre, then ring after ring, each walked
// clockwise from its top-left corner.
export function spiral(n: number): Axial[] {
  const out: Axial[] = n > 0 ? [{ q: 0, r: 0 }] : [];
  for (let k = 1; out.length < n; k++) {
    let q = NEIGHBOURS[4].q * k;
    let r = NEIGHBOURS[4].r * k;
    for (let side = 0; side < 6; side++) {
      for (let step = 0; step < k; step++) {
        out.push({ q, r });
        q += NEIGHBOURS[side].q;
        r += NEIGHBOURS[side].r;
      }
    }
  }
  return out.slice(0, n);
}

// Deterministic layout: inside a vendor, sites are ordered by agents down (slug
// breaks ties) and dealt onto the spiral, so the worst sites sit in the middle.
export function layoutComb(sites: Site[], vendors: Pick<VendorStats, "slug" | "name" | "color">[]): Comb {
  const max = Math.max(1, ...sites.map((s) => s.maydays_count));
  let ring = 1;

  const clusters = vendors.map((v) => {
    const mine = sites
      .filter((s) => s.vendor === v.slug)
      .sort((a, b) => b.maydays_count - a.maydays_count || a.slug.localeCompare(b.slug));
    const at = spiral(mine.length);
    const cells = mine.map((site, i): Cell => {
      const { q, r } = at[i];
      ring = Math.max(ring, ringOf(q, r));
      const rate = siteRate(site);
      return {
        site,
        q,
        r,
        ...centre(q, r),
        rate,
        color: blipColor(rate),
        fill: 0.2 + 0.68 * Math.sqrt(site.maydays_count / max),
      };
    });
    return { slug: v.slug, name: v.name, color: v.color, cells };
  });

  // One empty cell of margin on every side. The width is a whole number of
  // cells and the height a whole number of row pairs, which is what lets
  // neighbouring clusters share one lattice.
  const width = (2 * ring + 2) * ACROSS;
  const height = 3 * HEX * (ring + 1);

  let lattice = "";
  for (let r = -(ring + 2); r <= ring + 2; r++) {
    const y = ROW * r;
    if (Math.abs(y) > height / 2 + HEX) continue;
    const span = ring + 2;
    for (let q = Math.ceil(-span - r / 2); q <= Math.floor(span - r / 2); q++) {
      const { x } = centre(q, r);
      if (Math.abs(x) > width / 2 + ACROSS / 2) continue;
      lattice += `M${hexPoints(x, y).split(" ").join("L")}Z`;
    }
  }

  return { clusters, width, height, lattice };
}
