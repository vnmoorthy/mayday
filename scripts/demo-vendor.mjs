// Sets up the vendor-side demo on Pioneer's own fictional vendor, HivePay, so
// nothing is ever pinned in a real company's name. Safe to run again: every
// step looks before it writes.
//
//   node --env-file=.env.local scripts/demo-vendor.mjs [--url https://your-deployment]
//
// 1. Upserts the HivePay vendor (verified: it is Pioneer's own vendor).
// 2. Flies the flights/hivepay-payout scenario SDK offline to get its real
//    error strings and reports one stop signal for each crash site that is missing.
// 3. Claims the airspace.
// 4. Drafts a fix for every crash site with no vendor-pinned fix, reviews the
//    draft against the SDK's real requirement, and pins it.
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for the vendor
// row (and for the claim when Stripe Checkout is live). Everything else goes
// through the public API. It only ever touches the hivepay airspace.

import { createClient } from "@supabase/supabase-js";

const VENDOR = { slug: "hivepay", name: "HivePay", color: "#17130d", domains: ["hivepay.example"], verified: true };
const SURFACE = "hivepay.payouts.create()";
const AGENT = "demo-pioneer";

const args = process.argv.slice(2);
function option(name) {
  const i = args.indexOf(`--${name}`);
  if (i >= 0) return args[i + 1];
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : undefined;
}
const BASE = (option("url") || process.env.PIONEER_URL || "http://localhost:3000").replace(/\/+$/, "");

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run with: node --env-file=.env.local scripts/demo-vendor.mjs");
  process.exit(1);
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function call(path, body, timeoutMs = 30_000) {
  const res = await fetch(BASE + path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
}

const why = (r) => r.json?.error || r.text.slice(0, 160) || `status ${r.status}`;

// The four requirements the HivePay SDK enforces and its published docs never
// mention, in the order an agent meets them. `message` is what the SDK throws
// (re-read from the SDK below); `fix` is the reviewed fix HivePay stands behind;
// `accept` is the review a model's draft has to pass before it is pinned.
const SITES = [
  {
    code: "HP_AMOUNT_MINOR_UNITS",
    message: "amount must be an integer number of minor units",
    title: "HivePay payout refused: amount must be an integer number of minor units",
    tried: "amount: 49.99 (dollars, as the payouts guide shows)",
    change: "amount: 4999 (an integer number of minor units, cents for usd)",
    apply: (c) => void (c.params.amount = 4999),
    accept: (t) => /minor units?|cents/i.test(t) && /integer|whole number|Math\.round|4999/i.test(t),
    fix: {
      body:
        "The cause is that payouts.create() takes amount as an integer number of minor units, not a decimal amount in the major unit as the payouts guide shows. " +
        "Pass 4999 for $49.99 (cents for usd, eur, gbp, cad and aud; jpy and krw have no minor unit, so pass the whole amount). " +
        "Convert once with Math.round(dollars * 100) and never send a float.",
      fix_snippet:
        'await hivepay.payouts.create(\n  { amount: Math.round(49.99 * 100), currency: "usd", destination, metadata }, // 4999, not 49.99\n  { idempotencyKey },\n);',
    },
  },
  {
    code: "HP_IDEMPOTENCY_FORMAT",
    message: "idempotency key is missing or malformed",
    title: "HivePay payout refused: idempotency key is missing or malformed",
    tried: 'idempotencyKey: "idem-8841" (any unique string, as the payouts guide says)',
    change: 'idempotencyKey: "hp_" followed by 24 lowercase hex characters',
    apply: (c) => void (c.options.idempotencyKey = "hp_0123456789abcdef01234567"),
    accept: (t) => /hp_/.test(t) && /\b24\b/.test(t) && /hex/i.test(t),
    fix: {
      body:
        'The cause is that the idempotency key is not free-form: it must be "hp_" followed by exactly 24 lowercase hex characters, and it is required. ' +
        'Generate it as "hp_" + randomBytes(12).toString("hex"), store it with the payout you are making, and reuse the same key when you retry that payout so it is not paid twice.',
      fix_snippet:
        'import { randomBytes } from "node:crypto";\n\nconst idempotencyKey = "hp_" + randomBytes(12).toString("hex"); // hp_ + 24 lowercase hex\nawait hivepay.payouts.create(params, { idempotencyKey });',
    },
  },
  {
    code: "HP_DESTINATION_SHAPE",
    message: "destination is not a valid destination",
    title: "HivePay payout refused: destination is not a valid destination",
    tried: 'destination: "ba_tok_8f2c41d7a9" (the bare bank account token, as the payouts guide shows)',
    change: 'destination: { type: "bank_account", token: "ba_tok_8f2c41d7a9" }',
    apply: (c) => void (c.params.destination = { type: "bank_account", token: "ba_tok_8f2c41d7a9" }),
    accept: (t) => /bank_account/.test(t) && /\btype\b/.test(t) && /\btoken\b/.test(t),
    fix: {
      body:
        "The cause is that destination must be an object, not the bare bank account token string the payouts guide shows. " +
        'Pass { type: "bank_account", token } where token is the ba_tok_ value returned when the seller linked the account. ' +
        'type must be exactly "bank_account" and token must be a non-empty string.',
      fix_snippet:
        'await hivepay.payouts.create(\n  { amount, currency, destination: { type: "bank_account", token: "ba_tok_8f2c41d7a9" }, metadata },\n  { idempotencyKey },\n);',
    },
  },
  {
    code: "HP_REFERENCE_LENGTH",
    message: "reference rejected by the receiving bank",
    title: "HivePay payout refused: reference rejected by the receiving bank",
    tried: 'metadata.reference: "October marketplace payout, seller 8841" (39 characters)',
    change: 'metadata.reference: "Oct payout 8841" (18 characters or fewer)',
    apply: (c) => void (c.params.metadata = { reference: "Oct payout 8841" }),
    accept: (t) => /\b18\b/.test(t) && /reference/i.test(t),
    fix: {
      body:
        "The cause is that metadata.reference is printed on the seller's bank statement and may be at most 18 characters, so a longer reference is refused. " +
        'Shorten it to 1 to 18 characters, for example "Oct payout 8841", and keep any longer description in another metadata field.',
      fix_snippet:
        'await hivepay.payouts.create(\n  { amount, currency, destination, metadata: { reference: "Oct payout 8841" } }, // at most 18 characters\n  { idempotencyKey },\n);',
    },
  },
];

const errorText = (s) => `HivePayError [${s.code}]: ${s.message}`;
const codeOf = (text) => SITES.find((s) => String(text ?? "").includes(s.code));

// Fly the scenario's SDK offline, exactly as the docs say, fixing one refusal
// at a time. This is where the error strings come from, and it proves that
// each change really gets past its check before anything is reported.
async function flyScenario() {
  try {
    const sdk = await import(new URL("../flights/hivepay-payout/sdk/hivepay.mjs", import.meta.url).href);
    const client = sdk.createClient({ apiKey: "hp_test_offline" });
    const c = {
      params: {
        amount: 49.99,
        currency: "usd",
        destination: "ba_tok_8f2c41d7a9",
        metadata: { reference: "October marketplace payout, seller 8841" },
      },
      options: { idempotencyKey: "idem-8841" },
    };
    for (const s of SITES) {
      let thrown = null;
      try {
        await client.payouts.create(structuredClone(c.params), { ...c.options });
      } catch (e) {
        thrown = e;
      }
      if (!thrown || thrown.code !== s.code) throw new Error(`expected ${s.code}, got ${thrown?.code ?? "a paid payout"}`);
      s.message = String(thrown.message).replace(/^HivePayError \[[A-Z0-9_]+\]:\s*/, "");
      s.apply(c);
    }
    const paid = await client.payouts.create(c.params, c.options);
    console.log(`  scenario SDK flown offline: 4 refusals, then payout ${paid.id} ${paid.status}`);
    return true;
  } catch (e) {
    console.log(`  could not fly the scenario SDK (${e.message}); using its recorded error strings`);
    return false;
  }
}

async function hivepaySites() {
  const r = await call("/api/v1/map");
  if (r.status !== 200 || !Array.isArray(r.json?.sites)) throw new Error(`GET /api/v1/map failed: ${why(r)}`);
  return r.json.sites.filter((s) => s.vendor === VENDOR.slug);
}

console.log(`HivePay demo set-up against ${BASE}\n`);

// --- 1. the vendor ------------------------------------------------------------
console.log("1. Vendor");
{
  const { data, error } = await db.from("vendors").upsert(VENDOR, { onConflict: "slug" }).select("*").single();
  if (error) {
    console.error(`  could not upsert the vendor: ${error.message}`);
    process.exit(1);
  }
  console.log(`  ${data.name} (${data.slug}) upserted · verified ${data.verified} · claimed ${data.claimed}`);
}

// --- 2. crash sites -----------------------------------------------------------
console.log("\n2. Crash sites");
let sites = await hivepaySites();
const missing = SITES.filter((s) => !sites.some((site) => String(site.sample_error).includes(s.code)));
if (missing.length === 0) {
  console.log(`  all four crash sites are already charted (${sites.length} HivePay site${sites.length === 1 ? "" : "s"}); leaving them`);
} else {
  const flown = await flyScenario();
  for (const s of missing) {
    const error = errorText(s);
    // Read-only check first: never add a stop signal to some other crash site.
    const near = await call("/api/v1/approach", { error, vendor: VENDOR.slug });
    if (near.json?.known && near.json.site && !String(near.json.site.sample_error).includes(s.code)) {
      console.log(`  SKIP ${s.code}: it would match the existing site "${near.json.site.slug}"`);
      continue;
    }
    const r = await call("/api/v1/mayday", {
      error,
      vendor: VENDOR.slug,
      surface: SURFACE,
      title: s.title,
      agent: AGENT,
      source: "harvest",
      session_id: "demo-vendor-setup",
      attempts: [
        {
          step: 1,
          action: `Called hivepay.payouts.create() with ${s.tried}`,
          result: flown ? `${error}. The call got past this check after changing to ${s.change}.` : error,
        },
      ],
    });
    if (r.status !== 201 || !r.json?.site) {
      console.log(`  FAIL ${s.code}: ${why(r)}`);
      continue;
    }
    if (r.json.new_site) {
      // The matcher opens every new site as an endpoint; this one is an SDK call.
      await db.from("sites").update({ kind: "sdk" }).eq("id", r.json.site.id).eq("vendor", VENDOR.slug);
    }
    console.log(`  stop signal ${s.code} -> ${r.json.site.slug}${r.json.new_site ? " (new crash site)" : ""}`);
  }
  sites = await hivepaySites();
}

// --- 3. claim the airspace ----------------------------------------------------
console.log("\n3. Claim");
let claimMode = "unclaimed";
{
  const { data: before } = await db.from("vendors").select("claimed, claimed_at").eq("slug", VENDOR.slug).maybeSingle();
  if (before?.claimed) {
    claimMode = "already claimed";
    console.log(`  airspace already claimed${before.claimed_at ? ` (${before.claimed_at.slice(0, 16).replace("T", " ")} UTC)` : ""}`);
  } else {
    const r = await call("/api/stripe/claim", { vendor: VENDOR.slug });
    if (r.json?.claimed) {
      claimMode = r.json.mode === "demo" ? "demo (no Stripe keys on this server)" : `Stripe ${r.json.mode}`;
      console.log(`  claimed · mode ${r.json.mode}`);
    } else if (r.json?.url) {
      console.log(`  Stripe Checkout is live. Finish the claim in a browser to attach billing:\n  ${r.json.url}`);
      const { error } = await db.rpc("claim_vendor", { p_slug: VENDOR.slug });
      if (error) console.log(`  FAIL claim_vendor: ${error.message}`);
      else {
        claimMode = "service role (Stripe Checkout still open)";
        console.log("  claimed through claim_vendor with the service role so the demo can continue");
      }
    } else {
      console.log(`  FAIL claim: ${why(r)}`);
    }
  }
}

// --- 4. pinned fixes ----------------------------------------------------------
console.log("\n4. Pinned fixes");
let pinned = 0;
let alreadyPinned = 0;
let skipped = 0;
for (const site of sites) {
  const known = codeOf(site.sample_error);
  if (!known) {
    skipped += 1;
    console.log(`  skip ${site.slug}: no error code this script knows a reviewed fix for`);
    continue;
  }
  const detail = await call(`/api/v1/site/${encodeURIComponent(site.slug)}`);
  if (detail.status !== 200) {
    console.log(`  FAIL ${site.slug}: ${why(detail)}`);
    continue;
  }
  if ((detail.json.flares ?? []).some((f) => f.kind === "official")) {
    alreadyPinned += 1;
    console.log(`  ${known.code}: already has a vendor-pinned fix`);
    continue;
  }

  let fix = known.fix;
  let origin = "reviewed fix";
  let draft = null;
  try {
    draft = await call("/api/v1/draft-fix", { site: site.slug }, 75_000);
  } catch (e) {
    console.log(`  ${known.code}: drafting did not answer (${e.message})`);
  }
  if (draft?.status === 200 && draft.json?.body) {
    console.log(`  ${known.code}: draft from ${draft.json.provider ?? "model"} ${draft.json.model ?? ""}`.trimEnd());
    console.log(`    body: ${draft.json.body}`);
    if (draft.json.fix_snippet) console.log(`    snippet: ${draft.json.fix_snippet.replace(/\n/g, "\n             ")}`);
    if (known.accept(`${draft.json.body}\n${draft.json.fix_snippet ?? ""}`)) {
      fix = { body: draft.json.body, fix_snippet: draft.json.fix_snippet ?? "" };
      origin = "model draft, passed review";
    } else {
      console.log("    review: the draft does not state the exact requirement, pinning the reviewed fix instead");
    }
  } else if (draft) {
    console.log(`  ${known.code}: no draft (${draft.status}: ${why(draft)}), pinning the reviewed fix`);
  }

  const flare = (f) =>
    call("/api/v1/flare", { site_id: site.id, kind: "official", author: VENDOR.slug, body: f.body, fix_snippet: f.fix_snippet || null });
  let r = await flare(fix);
  if (r.status !== 200 && fix !== known.fix) {
    console.log(`    the draft was refused (${why(r)}), pinning the reviewed fix instead`);
    origin = "reviewed fix";
    r = await flare(known.fix);
  }
  if (r.status === 200 && r.json?.flare) {
    pinned += 1;
    console.log(`  ${known.code}: pinned (${origin}) on ${site.slug}`);
  } else {
    console.log(`  FAIL ${known.code}: could not pin: ${why(r)}`);
  }
}

// --- summary ------------------------------------------------------------------
const total = pinned + alreadyPinned;
console.log(
  `\nSummary: ${sites.length} HivePay crash site${sites.length === 1 ? "" : "s"} · ` +
    `${total} with a vendor-pinned fix (${pinned} pinned now, ${alreadyPinned} already there` +
    `${skipped ? `, ${skipped} skipped` : ""}) · claim: ${claimMode}`,
);
console.log(`Tower: ${BASE}/tower/${VENDOR.slug}`);
process.exit(claimMode === "unclaimed" || total < SITES.length ? 1 : 0);
