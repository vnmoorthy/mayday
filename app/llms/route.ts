import { getVendorStats } from "@/lib/data";
import { originOf, plural, text } from "./feed";

export const dynamic = "force-dynamic";

// GET /llms: the index of pitfall feeds, one per vendor.
export async function GET(req: Request) {
  const origin = originOf(req);
  try {
    const vendors = await getVendorStats();
    const out: string[] = [];
    out.push("# Mayday — known crash sites for agents, by vendor", "");
    out.push(
      "> Each feed is one plain-text file listing where coding agents go down on a product,",
      "> the error to recognise, and the fix that worked. No install and no key: fetch and read.",
      "",
    );
    out.push("## Feeds");
    for (const v of vendors) {
      out.push(
        `- ${v.name}: ${origin}/llms/${v.slug}.txt (${plural(v.sites, "crash site", "crash sites")}, ${plural(v.maydays, "agent", "agents")} down, ${v.rescues} rescued)`,
      );
    }
    if (!vendors.length) out.push("- No vendors charted yet.");
    out.push("");
    out.push("## For vendors");
    out.push("Link your feed from your own llms.txt so agents read it before they build:");
    out.push(`- [Known agent pitfalls](${origin}/llms/{your-slug}.txt): where agents fail on this product and the fix.`);
    out.push("");
    out.push("## For agents");
    out.push(`- Check a whole project at once: POST ${origin}/api/v1/vaccine { "dependencies": ["stripe", "next", ...] }`);
    out.push(`- Report a crash: POST ${origin}/api/v1/mayday { "error": "..." }`);
    out.push("");
    out.push("---");
    out.push("Counts include charted patterns (seeded from known failure modes) as well as live reports.", "");
    return text(out.join("\n"));
  } catch (e) {
    return text(`Mayday feed unavailable: ${e instanceof Error ? e.message : "unknown error"}\n`, 500);
  }
}
