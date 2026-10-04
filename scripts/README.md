# Scripts

Three scripts, each run from the repository root.

| Script | What it does | Needs |
|---|---|---|
| [`seed.ts`](#seedts-charting-the-airspace) | Charts the 40 known crash sites and generates the seeded traffic around them | Node 24, Supabase URL and service role key |
| [`stripe-setup.mjs`](#stripe-setupmjs-pay-per-rescue) | Creates the Stripe meter, product and price that pay per rescue runs on | A Stripe test-mode secret key |
| [`test-flight.mjs`](#test-flightmjs-test-flights) | Launches a real agent at a trap scenario and records where it goes down | The `claude` CLI, signed in |

`seed-data.ts` is not a script: it is the data `seed.ts` loads.

## `seed.ts`: charting the airspace

`seed-data.ts` holds the charted crash sites: 4 vendors and 40 well-known
places where coding agents go down on Stripe, Supabase, Vercel (and Next.js)
and Anthropic, ten per vendor. Each one has the real error text the product
emits, 2-3 agent flares with a concrete fix, and a black-box replay of the
wrong turns an agent takes before giving up.

`seed.ts` loads them into Supabase and generates the traffic around them.

```bash
# apply every migration in supabase/migrations/ first (npx supabase db push), then:
node --env-file=.env.local scripts/seed.ts             # add whatever is missing
node --env-file=.env.local scripts/seed.ts --reset     # remove seeded rows, then reseed
node scripts/seed.ts --dry-run                         # validate and print the plan, touch nothing
```

Needs Node 24 (it runs the TypeScript directly) and, in `.env.local`,
`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. `--dry-run` needs
neither. Node prints a `MODULE_TYPELESS_PACKAGE_JSON` warning on start; it is
harmless. Any other flag is rejected.

### What it writes

Everything carries `source = 'seed'`, so the UI can always tell charted
numbers from live traffic. **The counts are illustrative, not measured.**

| Table | Rows |
|---|---|
| `vendors` | stripe, supabase, vercel, anthropic (name, colour, domains; `claimed` is never touched) |
| `sites` | one per crash site; `signature` is `normalizeError(sample_error)`, computed, never hand-written |
| `flares` | 2-3 per site, all `kind = 'agent'`. Official flares are not seeded: vendors pin those live |
| `maydays` | `weight` per site (2,076 in total), spread over the last 14 days, denser in the last 48 hours |
| `rescues` | 35-70% of each site's stop signals (1,095 in total), attached to the site's first flare, `billable = false` |

The generator is deterministic (mulberry32 seeded by the site slug), so two
runs produce the same agents, models, minutes lost and rescues. Only the
timestamps move, because they are measured back from the moment of the run.

Consistency rules the script keeps:

- A rescued stop signal has `outcome = 'rescued'`, and its rescue comes a few
  minutes after it and after the flare existed.
- The first flare's `helped` equals its seeded rescues. The other flares carry
  a handful of ratings only (what `POST /api/v1/rate` records), always fewer,
  so the first flare sorts to the top.
- After inserting, each site's `maydays_count`, `rescues_count`,
  `minutes_lost`, `first_seen` and `last_seen` are set from the rows actually
  in the database, seeded and live together.

### Running it twice

Row ids are derived from the site slug, and rows are inserted with "skip if it
exists". A second run adds nothing and does not overwrite rows that live
traffic has changed (a flare's `helped`, for instance). A run that failed half
way is completed by running it again.

`--reset` deletes seeded rescues, stop signals and flares, then every crash site
that has nothing left pointing at it, and reseeds. Live and test-flight rows
are kept: a seeded flare that a live rescue points at is left in place, and a
site with any live stop signal, flare or rescue survives and is re-charted in place.

### Adding a crash site

Add an entry to `seed-data.ts`. Use the exact error the product emits, keep
`sample_error` short (the matcher looks for it inside longer incoming errors),
put the best fix first in `flares`, and give it a `weight` between 3 and 120.
`--dry-run` validates the data (unique slugs and signatures, a known vendor,
2-3 flares, 3-5 replay steps, under 2,500 stop signals overall) without touching
the database. [CONTRIBUTING.md](../CONTRIBUTING.md) has a worked example.

## `stripe-setup.mjs`: pay per rescue

One-time setup of the Stripe objects billing needs, in test mode.

```bash
node --env-file=.env.local scripts/stripe-setup.mjs
```

Needs `STRIPE_SECRET_KEY` (a test-mode key). It refuses a live key
(`sk_live_` or `rk_live_`) and exits. It creates, or finds if they already
exist:

| Object | Details |
|---|---|
| Billing Meter | event name `pioneer_rescue` (or `STRIPE_METER_EVENT_NAME`), `sum` aggregation, customer mapped by the `stripe_customer_id` payload key, value from the `value` payload key |
| Product | id `pioneer_rescue`, "Pioneer rescue", unit label `rescue` |
| Price | $0.25 per rescue, metered, billed monthly, lookup key `pioneer_rescue_v1` |

It is safe to run again: everything is looked up before it is created. A
price cannot be edited, so if the existing price no longer points at this
meter and rate, a new one is created and takes over the lookup key.

When it finishes it prints the two lines to add to `.env.local` and to the
deployment's environment:

```
STRIPE_PRICE_ID=price_...
STRIPE_METER_EVENT_NAME=pioneer_rescue
```

and how to forward webhooks locally
(`stripe listen --forward-to localhost:3000/api/stripe/webhook`, then set
`STRIPE_WEBHOOK_SECRET`). The webhook is optional: the confirm redirect
already claims the airspace when the vendor returns from Checkout.

Without `STRIPE_SECRET_KEY` and `STRIPE_PRICE_ID` the app runs in demo billing
mode: airspaces are claimed immediately, rescues are counted, and nothing is
sent to Stripe.

## `test-flight.mjs`: test flights

Launches a real Claude Code agent, headlessly, at one of the trap scenarios
in `flights/`, and records whether it landed, how long it took and where it
went down.

```bash
node scripts/test-flight.mjs --scenario stripe-webhook --runs 3
node scripts/test-flight.mjs --scenario stripe-webhook --runs 3 --no-pioneer   # control
node scripts/test-flight.mjs --scenario supabase-client --url https://pioneer-hive.vercel.app
node scripts/test-flight.mjs --help
```

| Option | Meaning |
|---|---|
| `--scenario <name>` | Scenario directory under `flights/` (required). Today: `next-redirect`, `stripe-webhook`, `supabase-client` |
| `--runs <n>` | Number of flights, one after another (1 to 50, default 1) |
| `--no-pioneer` | Fly without the Pioneer plugin: the control run, no briefings |
| `--url <url>` | Pioneer server to report to (default `$PIONEER_URL` or `http://localhost:3000`) |
| `--model <model>` | Passed to `claude --model` (default: your Claude Code default) |
| `--keep` | Keep the temporary working copy after the flight |

Needs the `claude` CLI on PATH and a signed-in Claude Code. No env file is
required. Each flight has a four minute limit and costs real model usage.

What one flight does:

1. Copies `flights/<name>/.orig/` to a fresh temporary directory outside the
   repository and links this repository's `node_modules` into it, so the
   scenario can import the real SDKs offline.
2. Runs `node check.mjs` and warns if it already passes.
3. Runs `claude -p <TASK.md>` with `--permission-mode acceptEdits` and the
   tools Bash, Read, Edit and Write. With Pioneer on, the plugin is loaded
   (`--plugin-dir plugin`), its MCP tools are allowed too, and
   `PIONEER_SOURCE=harvest` is set, so the agent's failed commands are reported
   by the hook and labelled as test-flight data.
4. Restores `check.mjs` from `.orig/` and runs it again: exit 0 is a landing.
5. If something failed and the hook reported nothing (always the case with
   `--no-pioneer`), posts one summary stop signal with `source: "harvest"`, the
   scenario's vendor and surface from `flight.json`, the elapsed minutes and
   a three-step black box.

Output is one line per flight and a summary:

```
flight 1/3  ·  stripe-webhook  ·  Pioneer on  ·  PASS  ·  41s  ·  9 turns  ·  $0.12  ·  1 stop signal via hook
Summary: 3/3 landed · average 44s · 3 stop signals via hook · 0 harvest summaries · $0.37
```

(The numbers above show the format; they are not a recorded result.) The
exit code is 0 only when every flight landed. If the agent never took off
(not signed in, no credit), the script aborts without logging a stop signal.

A scenario is found only if `flights/<name>/.orig/TASK.md` exists.
[CONTRIBUTING.md](../CONTRIBUTING.md) explains how to add one.

## `demo-vendor.mjs`, `demo-incident.mjs`, `demo-reset.mjs`: the vendor-side demo

The vendor-side demo runs on Pioneer's own fictional vendor, **HivePay** (the
`flights/hivepay-payout` scenario), so nothing is ever pinned in a real
company's name. These scripts only touch the `hivepay` airspace.

```bash
node --env-file=.env.local scripts/demo-vendor.mjs                 # set up the airspace (safe to re-run)
node --env-file=.env.local scripts/demo-incident.mjs --count 8     # a release breaks agents: the spike
node --env-file=.env.local scripts/demo-reset.mjs                  # remove the incident, show it again
```

All three take the server from `--url`, then `PIONEER_URL`, then
`http://localhost:3000`.

| Script | What it does | Needs |
|---|---|---|
| `demo-vendor.mjs` | Upserts the HivePay vendor as `verified` (it is Pioneer's own vendor, the one verified vendor). Flies the scenario SDK offline to get its four real refusals (`HP_AMOUNT_MINOR_UNITS`, `HP_IDEMPOTENCY_FORMAT`, `HP_DESTINATION_SHAPE`, `HP_REFERENCE_LENGTH`) and reports a `harvest` stop signal for each crash site that is missing. Claims the airspace (demo mode without Stripe keys; with Stripe live it prints the Checkout URL and claims through `claim_vendor`). Then, for every crash site with no vendor-pinned fix, asks `POST /api/v1/draft-fix` for a draft, reviews it against the SDK's real requirement, and pins it; a draft that fails the review, or no model access, pins the hand-written fix instead. | Supabase URL and service role key |
| `demo-incident.mjs` | Simulates what no model was trained on: HivePay v2.4.0, "released 10 minutes ago", renames `destination.token`. Reports `--count` (default 8) `harvest` stop signals, `--delay` ms apart (default 400), from differently named agents, then reads `GET /api/v1/incidents?vendor=hivepay` and prints whether the spike was detected, with `recent` and `ratio`. It checks with `/api/v1/approach` first and stops before writing if the error would land on any other crash site. | Nothing but the server |
| `demo-reset.mjs` | Deletes the HivePay crash site whose sample error contains `HP_SCHEMA_V24`, with its stop signals, flares and rescues, and prints what it removed. `--dry-run` only prints. Nothing else is deleted. | Supabase URL and service role key |

The stop signals these scripts report carry `source = 'harvest'` and no minutes
lost: they are scripted demo traffic, not measured agent time.
