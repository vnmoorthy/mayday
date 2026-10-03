# Mayday design and contribution contract

This is the contract every change to Mayday is held to: the words we use, the
shape of the API, the pages, and the design language. Read it before you open
a pull request. For how the system works underneath, see
[ARCHITECTURE.md](ARCHITECTURE.md); for setup and day-to-day workflow, see
[CONTRIBUTING.md](../CONTRIBUTING.md).

## What Mayday is

A honeybee that is attacked at a flower flies home and gives its nestmates a
**stop signal**, so the hive stops sending foragers down that path. One bee
pays; the hive does not. Agents have no stop signal. Mayday is the stop signal
for agents.

When an agent goes down on a product (a Stripe webhook, a Supabase RLS policy,
a Vercel build), it sends a **mayday**. Postgres matches the error to a
**crash site**, counts it, and returns the **flares** (tips) earlier agents
left there, with the vendor's pinned **official fix** first. When a flare gets
an agent back in the air, that is a **rescue**. Vendors **claim their
airspace** (Stripe Checkout) to open their **tower**: a ranked map of where
agents crash on their product, with the power to pin official fixes and pay
per rescue. **Test flights** are real agent runs launched on purpose to find
crash sites before agents in the wild do.

It must work end to end: every button and link does something real.

## Vocabulary (use these words in UI copy, docs and tool descriptions)

| Term | Meaning |
|---|---|
| mayday | one failure report from one agent |
| crash site | a place on a vendor's product where agents fail (table `sites`) |
| flare | a tip left at a crash site; `kind` is `agent` or `official` |
| official fix | a flare with `kind = 'official'`, pinned by the vendor that claimed the airspace |
| rescue | a flare that got an agent through |
| airspace | everything belonging to one vendor |
| tower | the vendor's dashboard |
| hive map | the public live map of every airspace (the home page) |
| airworthiness | a vendor's public rating: how well agents fly on its product |
| preflight | what an agent reads before building on a product: the rating and the known crash sites |
| test flight | a deliberate agent run that hunts for crash sites (`source = 'harvest'`) |
| black box | the `attempts` array on a mayday: what the agent tried, step by step |

`source` on maydays, flares and rescues is `live`, `harvest` (test flight) or
`seed` (charted from known failure patterns). **Always show which it is; never
present seeded numbers as live traffic.** This rule has no exceptions.

## Where things live

- `lib/types.ts`: every shared type. Read it first.
- `lib/data.ts`: server-only data access. Every route handler, the MCP server
  and every server component goes through it: `getVendorStats`, `getVendor`,
  `getSites`, `getSiteDetail`, `getRecentMaydays`, `getRecentRescues`,
  `approach`, `reportMayday`, `leaveFlare`, `recordRescue`, `rateFlare`,
  `claimVendor`, `markRescueBilled`, `getBilling`, `getRatings`, `getRating`.
- `lib/signature.ts`: `normalizeError`, `extractCodes`, `detectVendor`,
  `titleFromError` (pure, usable anywhere).
- `lib/airworthiness.ts`: `rate`, `gradeFor`, `gradeTone` (pure).
- `lib/mcp.ts`: the tool names, descriptions and the text every MCP tool
  returns (pure, so the cockpit can show exactly what an agent reads).
- `lib/http.ts`: CORS, error mapping and the zod request schemas.
- `lib/stripe.ts`: the billing interface. Other modules only call
  `billRescue` and `stripeConfigured`.
- `lib/supabase/server.ts` (`supabaseAdmin`, service role, server only) and
  `lib/supabase/browser.ts` (`supabaseBrowser`, anon key, Realtime; returns
  null when env is missing).
- `lib/format.ts`: `timeAgo`, `minutesToHuman`, `rescueRate`, `compact`,
  `dollars`, `hash01`.
- `components/ui.tsx`: `Panel`, `Label`, `Badge`, `Stat`, `Button`,
  `ButtonLink`, `Empty`.
- `components/nav.tsx`, `app/layout.tsx`, `app/globals.css`: the shell and the
  design tokens.
- `supabase/migrations/`: schema, RLS, functions and the Realtime publication.
- `plugin/`: the Claude Code plugin (hook, skill, MCP connection).
- `scripts/`: seed, Stripe setup and the test-flight runner. `flights/`: the
  test-flight scenarios.

## HTTP API (JSON in, JSON out; errors are `{ "error": string }` with a real status code)

| Route | Body / params | Returns |
|---|---|---|
| `POST /api/v1/approach` | `{ error, vendor? }` | `Briefing` (read-only, nothing is logged) |
| `POST /api/v1/mayday` | `{ error, vendor?, surface?, title?, agent?, model?, session_id?, attempts?, minutes_lost?, source? }` | `Briefing` with `mayday_id` and `new_site` (201) |
| `POST /api/v1/flare` | `{ site_id, body, author, kind?, fix_snippet?, source? }` | `{ flare }`; 403 when `kind: "official"` and the airspace is unclaimed |
| `POST /api/v1/rescue` | `{ site_id, flare_id, agent, mayday_id?, minutes_saved?, source? }` | `{ rescue, vendor, billable, billed, stripe_event?, billing_note? }` |
| `POST /api/v1/rate` | `{ flare_id, helped }` | `{ flare }`; 404 for an unknown flare |
| `GET /api/v1/preflight/[vendor]` | vendor slug | `Preflight`: `{ vendor, rating, sites: [{ site, top_flare }] }` (the 8 crash sites with the most maydays); 404 for an unknown airspace |
| `GET /api/v1/map` | none | `{ vendors: VendorStats[], sites: Site[], maydays: FeedMayday[], rescues: FeedRescue[], ratings: Record<slug, Rating> }` |
| `GET /api/v1/site/[slug]` | slug or id | `SiteDetail` |
| `GET /api/v1/billing/[vendor]` | vendor slug | `Billing` plus `{ stripe: { configured, mode } }` |
| `GET /api/badge/[vendor]` | vendor slug, `.svg` suffix optional | the airworthiness badge as SVG; always 200, a grey `UNRATED` badge when there is nothing to show |
| `POST /api/stripe/claim` | `{ vendor }` | `{ url }` for Stripe Checkout, or `{ claimed: true, mode: "demo" }` when Stripe is not configured |
| `GET /api/stripe/confirm` | `?session_id=&vendor=` | verifies the session with Stripe, claims the vendor, redirects to `/tower/[vendor]?claimed=1` (or `?claim_error=`) |
| `POST /api/stripe/webhook` | Stripe event | 200; claims the airspace on `checkout.session.completed` |
| `/api/mcp` | MCP over streamable HTTP | nine tools: `mayday_waggle`, `mayday_preflight`, `mayday_approach`, `mayday_report`, `mayday_rescued`, `mayday_flare`, `mayday_replay`, `mayday_landed`, `mayday_chart_route` |

The API is open (no auth) today; see "Known limits" in the architecture
document. Validate input with zod (`lib/http.ts`) and never trust lengths:
`error` is truncated to 4000 characters, `body` is capped at 1200,
`fix_snippet` at 4000, a black box at 40 steps of 600 characters each.

### MCP tools

| Tool | When the agent calls it |
|---|---|
| `mayday_waggle` | Before starting a task: the proven route, step by step |
| `mayday_preflight` | Before building on a product: the airworthiness rating plus known crash sites and fixes |
| `mayday_approach` | Before retrying a failing step: is this a known crash site? Read-only |
| `mayday_report` | A step failed: log the mayday, get the briefing |
| `mayday_rescued` | A flare worked: confirm the rescue |
| `mayday_flare` | Found a new fix: leave it for the next agent |
| `mayday_replay` | See what earlier agents tried at a crash site, step by step |
| `mayday_landed` | Report whether a route worked |
| `mayday_chart_route` | Found a way through that was not charted: leave the route |

Tool descriptions are written for an agent to read: when to call, what comes
back. They live in `lib/mcp.ts`. If you add or change a tool, update that file,
`app/api/mcp/route.ts`, `plugin/README.md`, `plugin/skills/mayday/SKILL.md`
and the tables in this document and the README.

## Pages

| Route | What it is |
|---|---|
| `/` | the hive map: every vendor's airspace, crash sites as cells, the live feed |
| `/tower`, `/tower/[vendor]` | tower index and the vendor dashboard |
| `/site/[slug]` | public crash-site page: count, flares, black-box replays |
| `/cockpit` | "fly as an agent": send an error, see exactly what an agent gets back |
| `/install` | how to connect an agent (MCP URL, Claude Code plugin, curl) |
| `/flights` | test flights: scenarios, results, how to launch one |
| `/deck` | the pitch deck: the stop-signal story, the product and the business in slides |

## Design language: honey yellow and near-black

A honey-yellow field with near-black type, and photographs of real honeycomb
and bees. There is no blue anywhere in the interface. The tokens are defined
in `app/globals.css`; use the Tailwind classes, never raw hex values.

- Field and surfaces: `bg-bg` (honey yellow `#f6cf1b`), `bg-panel` (a lighter
  cell, `#f9db4a`), `bg-panel-2` (a darker cell for hover and wells,
  `#ecc10d`).
- Type: `text-ink` (near-black `#17130d`), `text-mute` (`#54491a`, secondary),
  `text-dim` (`#86761f`, tertiary).
- Rules: `border-line` (a darker yellow hairline, `#d9b30a`), `border-line-2`
  (near-black, for strong rules and outlines).
- Brand mark and primary actions are near-black on yellow: `text-honey`,
  `bg-honey`, `text-radar`, `bg-radar` all resolve to `#17130d`.
- Photography: the honeycomb and bee photographs in `public/art/` (`hero.jpg`,
  `comb.jpg`, `bee.jpg`, `stop.jpg`) carry the hive. `.comb-bg` is a drawn
  honeycomb line pattern, `.grid-bg` a faint dot field, and `.hex` clips an
  element to a hexagon. Do not draw radar sweeps or aviation chrome; the
  vocabulary carries the flight metaphor, the visuals carry the hive.
- Data colours, and only for data: `text-distress` (red `#b80f26`, maydays),
  `text-flare` (burnt honey `#7a3f00`, flares and pinned fixes), `text-rescue`
  (near-black `#17130d`, rescues). Rescued cells are capped in pale wax
  (`comb`, `#fff6c2`). Never use them for decoration.
- Vendor colours come from `vendor.color` and are used for identity only (a
  small square swatch, a cell outline), never as body text.
- Corners are rounded: radius tokens run from 4px (`rounded-xs`) to 32px
  (`rounded-3xl`). Dots use `rounded-full`.
- Structure with hairlines (`border-line`, `.rule`) and whitespace, not with
  filled cards. Prefer open sections separated by a rule over boxes in boxes.
- Type: headlines are large (text-4xl to text-7xl on desktop), weight ~450,
  tracking around -0.035em (h1/h2/.display already do this). Body text is
  14-16px in `text-mute` or `text-ink`. `.label` is the small uppercase mono
  label used above every section and stat. Numbers use `.tabular`; big numbers
  are set large and light, not bold.
- Primary action: near-black button on the yellow field (`Button`/`ButtonLink` default).
  Secondary: hairline ghost button. The `flare` variant is the honey button,
  for the one action on a page that leaves a flare or pins a fix. Links can
  end with a "→".
- Icons from `lucide-react`, used sparingly at 14-16px with strokeWidth 1.5.
  No emoji. Motion with `framer-motion`, only for meaning (a new mayday
  arriving), respecting reduced motion.
- Must work at 375px wide and on a projector. Wide tables scroll inside their
  own container; the page never scrolls sideways.
- Every state is designed: loading, empty, error. If Supabase env is missing
  the page shows a clear "not connected" state instead of crashing.

## Engineering rules

1. This is Next.js 16 (App Router, React 19). `params` and `searchParams` are
   Promises. Read `node_modules/next/dist/docs/` if unsure; do not guess.
2. Server components and route handlers read through `lib/data.ts`. Client
   components call the HTTP API or use `supabaseBrowser()` for Realtime. The
   service-role client never reaches the browser.
3. Pages and routes that read the database export
   `const dynamic = "force-dynamic"`.
4. Business rules belong in Postgres. If a rule decides who may write what
   (official fixes, billable rescues), it is enforced in a SQL function, not
   only in a route handler.
5. Avoid new dependencies. The stack is next, react, @supabase/supabase-js,
   mcp-handler, @modelcontextprotocol/sdk, zod (v4), stripe, framer-motion,
   lucide-react, clsx, ai, server-only. Make the case in the pull request if
   you need another.
6. `pnpm exec tsc --noEmit` must be clean before you open a pull request.
7. No placeholder buttons, no "coming soon", no lorem ipsum, no fake data in
   components. If a feature cannot work without configuration, say so in the UI.
8. Data sources are always labelled: `live`, `harvest` or `seed`, in the UI,
   in MCP tool output and in docs.
9. Match the comment style of the shared files: short, plain, explains why.
