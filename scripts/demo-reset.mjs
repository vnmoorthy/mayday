// Removes what scripts/demo-incident.mjs created, so the incident can be shown
// again from the start: the HivePay crash site whose sample error contains
// HP_SCHEMA_V24, with its maydays, flares and rescues. Nothing else is touched:
// the four HivePay payout crash sites and their pinned fixes stay.
//
//   node --env-file=.env.local scripts/demo-reset.mjs [--dry-run]
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY: the public API
// has no delete.

import { createClient } from "@supabase/supabase-js";

const VENDOR = "hivepay";
const CODE = "HP_SCHEMA_V24";
const DRY = process.argv.includes("--dry-run");

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run with: node --env-file=.env.local scripts/demo-reset.mjs");
  process.exit(1);
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function stop(what, error) {
  console.error(`${what}: ${error.message}`);
  process.exit(1);
}

async function count(table, siteId) {
  const { count: n, error } = await db.from(table).select("id", { count: "exact", head: true }).eq("site_id", siteId);
  if (error) stop(`Could not count ${table}`, error);
  return n ?? 0;
}

const { data: sites, error } = await db
  .from("sites")
  .select("id, slug, title, vendor, sample_error")
  .eq("vendor", VENDOR)
  .ilike("sample_error", `%${CODE}%`);
if (error) stop("Could not read crash sites", error);

// Belt and braces: the query already filters, but nothing is deleted unless
// the row itself says hivepay and HP_SCHEMA_V24.
const targets = (sites ?? []).filter((s) => s.vendor === VENDOR && String(s.sample_error).includes(CODE));

if (targets.length === 0) {
  console.log(`Nothing to reset: no ${VENDOR} crash site contains ${CODE}.`);
  process.exit(0);
}

for (const site of targets) {
  const [maydays, flares, rescues] = await Promise.all([count("maydays", site.id), count("flares", site.id), count("rescues", site.id)]);
  const what = `${site.slug} ("${site.title}") · ${maydays} mayday${maydays === 1 ? "" : "s"}, ${flares} flare${flares === 1 ? "" : "s"}, ${rescues} rescue${rescues === 1 ? "" : "s"}`;
  if (DRY) {
    console.log(`Would remove ${what}`);
    continue;
  }
  // Maydays, flares and rescues go with the site (on delete cascade).
  const { error: gone } = await db.from("sites").delete().eq("id", site.id).eq("vendor", VENDOR).ilike("sample_error", `%${CODE}%`);
  if (gone) stop(`Could not remove ${site.slug}`, gone);
  console.log(`Removed ${what}`);
}

console.log(DRY ? "Dry run: nothing was removed." : "The incident is reset. Run scripts/demo-incident.mjs to show it again.");
