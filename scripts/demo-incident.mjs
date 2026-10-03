// Simulates the thing no model can know: a HivePay release that shipped ten
// minutes ago and breaks every agent that calls payouts.create(). It reports
// a burst of stop signals from differently named agents and then asks Pioneer
// whether the spike was detected. HivePay is Pioneer's own fictional vendor.
//
//   node --env-file=.env.local scripts/demo-incident.mjs [--count 8] [--delay 400] [--url https://your-deployment]
//
// Uses only the public API. Safe to run again: every run adds to the same
// crash site. scripts/demo-reset.mjs removes it so the incident can be shown
// from the start.

const VENDOR = "hivepay";
const CODE = "HP_SCHEMA_V24";
const SURFACE = "hivepay.payouts.create() · v2.4.0";
const ERROR =
  "HivePayError [HP_SCHEMA_V24]: field 'destination.token' was renamed to 'destination.account_token' in v2.4.0 (released 10 minutes ago)";
const TITLE = "HivePay v2.4.0 renamed destination.token to destination.account_token";
const AGENTS = ["claude-code", "cursor", "eve", "codex", "windsurf", "aider", "cline", "goose", "copilot-agent", "devin", "amp", "zed-agent"];

const args = process.argv.slice(2);
function option(name) {
  const i = args.indexOf(`--${name}`);
  if (i >= 0) return args[i + 1];
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : undefined;
}
function numberOption(name, fallback, min, max) {
  const raw = option(name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    console.error(`--${name} must be a number from ${min} to ${max}`);
    process.exit(1);
  }
  return Math.round(n);
}

const BASE = (option("url") || process.env.PIONEER_URL || "http://localhost:3000").replace(/\/+$/, "");
const COUNT = numberOption("count", 8, 1, 200);
const DELAY = numberOption("delay", 400, 0, 60_000);

async function call(path, body) {
  const res = await fetch(BASE + path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
}

const why = (r) => r.json?.error || r.text.slice(0, 160) || `status ${r.status}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

console.log(`HivePay incident against ${BASE}: ${COUNT} stop signal${COUNT === 1 ? "" : "s"}, ${DELAY}ms apart\n`);

// Read-only check first: if this error would land on some other crash site,
// stop before writing anything to it.
const near = await call("/api/v1/approach", { error: ERROR, vendor: VENDOR });
if (near.status !== 200) {
  console.error(`Could not reach Pioneer: ${why(near)}`);
  process.exit(1);
}
if (near.json?.known && near.json.site && !String(near.json.site.sample_error).includes(CODE)) {
  console.error(`Stopped: this error would match the existing crash site "${near.json.site.slug}", which is not the ${CODE} site. Nothing was written.`);
  process.exit(1);
}
console.log(near.json?.known ? `Crash site already open (${near.json.site.slug}); adding to it.` : "No crash site for this error yet: the first stop signal opens it.");

const run = Date.now().toString(36);
let sent = 0;
let site = null;
for (let i = 0; i < COUNT; i++) {
  const agent = AGENTS[i % AGENTS.length];
  const r = await call("/api/v1/mayday", {
    error: ERROR,
    vendor: VENDOR,
    surface: SURFACE,
    title: TITLE,
    agent,
    source: "harvest",
    session_id: `demo-incident-${run}-${i + 1}`,
    attempts: [
      {
        step: 1,
        action: 'Called hivepay.payouts.create() with destination: { type: "bank_account", token }, which worked before v2.4.0',
        result: ERROR,
      },
    ],
  });
  if (r.status !== 201 || !r.json?.site) {
    console.log(`  ${String(i + 1).padStart(2)}/${COUNT}  ${agent.padEnd(14)} FAIL  ${why(r)}`);
  } else if (!String(r.json.site.sample_error).includes(CODE)) {
    console.error(`  Stopped: stop signal ${i + 1} landed on "${r.json.site.slug}", which is not the ${CODE} site.`);
    process.exit(1);
  } else {
    sent += 1;
    site = r.json.site;
    const flares = r.json.flares?.length ?? 0;
    console.log(
      `  ${String(i + 1).padStart(2)}/${COUNT}  ${agent.padEnd(14)} down at ${site.slug}` +
        `${r.json.new_site ? "  (new crash site)" : ""}  ·  ${flares === 0 ? "no fix yet" : `${flares} fix${flares === 1 ? "" : "es"} returned`}`,
    );
  }
  if (DELAY && i < COUNT - 1) await sleep(DELAY);
}

if (!site) {
  console.error("\nNo stop signal was accepted, so there is nothing to detect.");
  process.exit(1);
}

const inc = await call(`/api/v1/incidents?vendor=${VENDOR}`);
if (inc.status !== 200) {
  console.error(`\nCould not read incidents: ${why(inc)}`);
  process.exit(1);
}
const incident = (inc.json.incidents ?? []).find((x) => x.site_id === site.id || x.slug === site.slug);
const windowMinutes = inc.json.window_minutes ?? 30;

console.log(`\nReported ${sent}/${COUNT} stop signals to ${site.slug}.`);
if (incident) {
  console.log(
    `Spike DETECTED: ${incident.recent} stop signals in the last ${windowMinutes} minutes · baseline ${incident.baseline} per window · ratio ${incident.ratio}x`,
  );
} else {
  console.log(
    `Spike NOT detected. An incident needs at least 3 stop signals in ${windowMinutes} minutes and 3 times the site's own baseline` +
      `${sent < 3 ? `; this run sent ${sent}` : ""}.`,
  );
}
console.log(`Tower:      ${BASE}/tower/${VENDOR}`);
console.log(`Crash site: ${BASE}/site/${site.slug}`);
console.log("Show it again from the start: node --env-file=.env.local scripts/demo-reset.mjs");
process.exit(incident || sent < 3 ? 0 : 1);
