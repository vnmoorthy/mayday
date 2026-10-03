import { gradeTone, type Rating } from "@/lib/airworthiness";
import { getRating, getVendor } from "@/lib/data";
import { CORS_HEADERS } from "@/lib/http";

export const dynamic = "force-dynamic";

// The airworthiness badge vendors embed in a README: black field, hairline
// white border, square corners. Colour is used for the grade only. It always
// answers 200 with an SVG (grey UNRATED when there is nothing to show) so an
// embed never renders as a broken image.

// Data colours from app/globals.css, written out because an SVG served to
// another site cannot read our CSS variables.
const TONE = { rescue: "#58b7ff", flare: "#f5a524", distress: "#ff3b30", mute: "#8a8a8a" } as const;

const LABEL = "PIONEER AIRWORTHINESS";
const H = 24;
const PAD = 10;
const CHAR = 7.2; // advance of one 11px mono capital, letter-spacing included
// Ratings are computed mostly from charted failure patterns, not measured
// traffic, so a rated badge says so in small type.
const NOTE = "PROVISIONAL";
const NOTE_CHAR = 5; // advance of one 7.5px mono capital, letter-spacing included
const FONT = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,'Liberation Mono',monospace";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

const px = (n: number) => String(Math.round(n * 10) / 10);

// textLength pins every run to the width the layout assumed, whichever
// monospace font the viewer has.
function run(x: number, value: string, fill: string, weight = 400): string {
  return (
    `<text x="${px(x)}" y="15.5" fill="${fill}" font-weight="${weight}" ` +
    `textLength="${px(value.length * CHAR)}" lengthAdjust="spacing">${esc(value)}</text>`
  );
}

function badge(name: string | null, rating: Rating | null): string {
  const rated = rating !== null && rating.score !== null;
  const grade = rated ? rating.grade : "UNRATED";
  const score = rated ? String(rating.score) : "";
  const colour = TONE[rated ? gradeTone(rating.grade) : "mute"];

  // The divider sits on a half pixel so the 1px hairline stays crisp.
  const split = Math.round(PAD + LABEL.length * CHAR + PAD) + 0.5;
  const valueChars = grade.length + (score ? 1 + score.length : 0);
  const noteX = split + PAD + valueChars * CHAR + PAD * 0.8;
  const width = Math.ceil(rated ? noteX + NOTE.length * NOTE_CHAR + PAD : split + PAD + valueChars * CHAR + PAD);
  const title = `Pioneer airworthiness${name ? `, ${name}` : ""}: ${
    rated ? `${grade} ${score}/100, provisional (computed mostly from charted failure patterns, not measured traffic)` : "unrated"
  }`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" role="img" aria-label="${esc(title)}">` +
    `<title>${esc(title)}</title>` +
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${H - 1}" fill="#000000" stroke="#ffffff" stroke-width="1"/>` +
    `<line x1="${px(split)}" y1="0.5" x2="${px(split)}" y2="${H - 0.5}" stroke="#ffffff" stroke-opacity="0.28" stroke-width="1"/>` +
    `<g font-family="${FONT}" font-size="11">` +
    run(PAD, LABEL, "#ffffff") +
    run(split + PAD, grade, colour, rated ? 700 : 400) +
    (score ? run(split + PAD + (grade.length + 1) * CHAR, score, "#ffffff") : "") +
    `</g>` +
    (rated
      ? `<text x="${px(noteX)}" y="14.5" fill="#ffffff" fill-opacity="0.72" font-family="${FONT}" font-size="7.5" ` +
        `textLength="${px(NOTE.length * NOTE_CHAR)}" lengthAdjust="spacing">${NOTE}</text>`
      : "") +
    `</svg>`
  );
}

function svg(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(_req: Request, ctx: { params: Promise<{ vendor: string }> }) {
  try {
    const { vendor } = await ctx.params;
    // /api/badge/stripe and /api/badge/stripe.svg are the same badge.
    const slug = decodeURIComponent(vendor).trim().toLowerCase().replace(/\.svg$/, "").slice(0, 64);
    const found = slug ? await getVendor(slug) : null;
    if (!found) return svg(badge(null, null));
    return svg(badge(found.name, await getRating(found.slug)));
  } catch {
    // Database down or not configured: still a valid image.
    return svg(badge(null, null));
  }
}
