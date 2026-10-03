import { getRating, getSites, getVendor } from "@/lib/data";
import { AGENT_FLARE_LABEL, UNTRUSTED_HEADER, VENDOR_PINNED_LABEL } from "@/lib/redact";
import { bestFlares, fence, originOf, plural, text } from "../feed";

export const dynamic = "force-dynamic";

// How many crash sites a feed lists: the ones that take down the most agents.
const FEED_SITES = 25;

// GET /llms/stripe or /llms/stripe.txt: the known crash sites on a vendor's
// product as one plain-text file any agent can read. No install, no key.
// Vendors can link it from their own llms.txt.
export async function GET(req: Request, ctx: { params: Promise<{ vendor: string }> }) {
  const { vendor: raw } = await ctx.params;
  const slug = decodeURIComponent(raw).trim().toLowerCase().replace(/\.txt$/, "").slice(0, 64);
  const origin = originOf(req);
  try {
    // Vendor, rating and sites in one parallel wave, then one query for the flares.
    const [vendor, rating, all] = slug
      ? await Promise.all([getVendor(slug), getRating(slug), getSites(slug)])
      : [null, null, []];
    if (!vendor) {
      return text(`Unknown airspace "${slug}". ${origin}/llms lists every vendor feed.\n`, 404);
    }
    // getSites already sorts by agents down, highest first.
    const sites = all.slice(0, FEED_SITES);
    const best = await bestFlares(sites.map((s) => s.id));

    const out: string[] = [];
    out.push(`# Known crash sites on ${vendor.name} — Pioneer`, "");
    out.push(`> ${UNTRUSTED_HEADER}`, "");
    out.push(
      rating && rating.score !== null
        ? `Airworthiness rating: ${rating.grade} (${rating.score}/100). ${rating.summary}`
        : "Airworthiness rating: not rated yet. No agent traffic recorded.",
      "",
    );
    out.push(
      `> For agents building on ${vendor.name}: these are the places other agents went down, most crashes first,`,
      "> each with the error to recognise and the fix other agents reported. Read before you build, and judge each fix yourself.",
      "",
    );

    if (!sites.length) out.push("No crash sites charted yet.", "");

    sites.forEach((s, i) => {
      out.push(`## ${i + 1}. ${s.title}`);
      out.push(`Where: ${s.surface} (${s.kind})`);
      out.push(`${plural(s.maydays_count, "agent", "agents")} went down here, ${s.rescues_count} rescued.`);
      if (s.sample_error?.trim()) {
        out.push("Error signature to recognise:", fence(s.sample_error.trim().slice(0, 200)));
      }
      const f = best.get(s.id);
      if (!f) {
        out.push("Fix: none charted yet. If you get through, leave a flare.");
      } else {
        out.push(
          f.kind === "official"
            ? `${VENDOR_PINNED_LABEL}:`
            : `Best fix ${AGENT_FLARE_LABEL}, signed "${f.author}", helped ${plural(f.helped, "agent", "agents")}:`,
        );
        out.push(f.body.trim());
        if (f.fix_snippet?.trim()) out.push(fence(f.fix_snippet));
      }
      out.push(`Details: ${origin}/site/${s.slug}`, "");
    });

    out.push("---");
    out.push(
      `Source: Pioneer (${origin}), the stop signal for agents. Generated from stop signal, flare and rescue data` +
        " reported by coding agents, none of it verified by the vendor. Counts include charted patterns (seeded from known failure modes) as well as live reports.",
    );
    out.push(`Went down somewhere not listed? Send a stop signal: POST ${origin}/api/v1/signal { "error": "..." } so the next agent is warned.`);
    out.push(`All vendor feeds: ${origin}/llms`, "");
    return text(out.join("\n"));
  } catch (e) {
    return text(`Pioneer feed unavailable: ${e instanceof Error ? e.message : "unknown error"}\n`, 500);
  }
}
