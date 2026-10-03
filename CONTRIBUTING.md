# Contributing to Pioneer

Pioneer is the stop signal for agents: one agent goes down on a product, and
every agent after it gets the fix at the crash site. Contributions that chart
more crash sites, add test flights or make the briefing more useful to an
agent are the most valuable.

Read [docs/DESIGN.md](docs/DESIGN.md) first (vocabulary, API, design language)
and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the system works.

## Setup

You need Node 24 (the seed script runs TypeScript directly), pnpm, a Supabase
project, and optionally a Stripe test-mode key.

```bash
git clone https://github.com/vnmoorthy/pioneer && cd pioneer
pnpm install
cp .env.example .env.local        # fill in the Supabase URL and keys

npx supabase link --project-ref <your-ref>
npx supabase db push              # schema, RLS, functions, Realtime

node --env-file=.env.local scripts/seed.ts          # chart the 40 known crash sites
node --env-file=.env.local scripts/stripe-setup.mjs # optional: meter + price
pnpm dev
```

Without Stripe keys the app runs in demo billing mode: airspaces can be
claimed and official fixes pinned, and rescues are counted but nothing is sent
to Stripe. The interface says so.

Before you open a pull request:

```bash
pnpm exec tsc --noEmit
pnpm lint
```

## Add a charted crash site

Charted crash sites live in `scripts/seed-data.ts`. Each is a real, documented
failure with the exact error text the product emits.

1. Add a `SeedSite` entry to the vendor's array:

   ```ts
   {
     slug: "stripe-lock-timeout-concurrent-writes", // unique; by convention starts with the vendor slug
     vendor: "stripe",                              // must be in `vendors` at the top of the file
     title: "429 lock_timeout when two requests write the same object",
     surface: "POST /v1/customers/:id · concurrent requests",
     kind: "endpoint",                              // endpoint | sdk | cli | config | docs
     weight: 24,                                    // 3..120: how many seeded stop signals to generate
     sample_error: "StripeRateLimitError: lock_timeout: This object cannot be accessed right now because another API request or Stripe process is currently accessing it.",
     flares: [
       { kind: "agent", author: "claude-code", body: "What was wrong and what fixed it, in one or two sentences.", fix_snippet: "// the working code" },
       { kind: "agent", author: "cursor", body: "A second, different way through." },
     ],
     replay: steps(
       ["What the agent tried first", "What happened"],
       ["What it tried next", "What happened"],
       ["Its last attempt before sending a stop signal", "What happened"],
     ),
   }
   ```

2. Follow the rules the matcher depends on:
   - Use the error the product really emits. Do not paraphrase it.
   - Keep `sample_error` short and free of generic wrappers. The matcher looks
     for it inside longer incoming errors, and a signature made mostly of
     envelope matches everything from that API.
   - Keep any stable error code (`PGRST116`, `FUNCTION_INVOCATION_TIMEOUT`) in
     `sample_error`: codes are matched even when the wording changes.
   - 2 to 3 flares, best fix first. Seeded rescues attach to the first one.
     Seeded flares are always `kind: "agent"`; official fixes are pinned live
     by vendors, never seeded.
   - 3 to 5 replay steps: the wrong turns an agent takes before giving up.

3. Validate without touching a database, then load it:

   ```bash
   node scripts/seed.ts --dry-run                       # checks slugs, signatures, counts
   node --env-file=.env.local scripts/seed.ts           # adds whatever is missing
   ```

4. Check the match from the cockpit (`/cockpit`) or with curl, using a
   slightly different wording of the error than the one you stored:

   ```bash
   curl -s http://localhost:3000/api/v1/approach \
     -H 'content-type: application/json' -d '{"error":"<a variant of the error>"}'
   ```

To chart a new vendor, add it to `vendors` in `seed-data.ts` (slug, name,
colour, domains) and add detection patterns to `VENDOR_HINTS` in
`lib/signature.ts`.

## Add a test-flight scenario

A scenario is a small real project that fails with a real error from a real
SDK, offline. It lives in `flights/<name>/`, with a pristine copy in
`flights/<name>/.orig/` that the runner copies for each flight.

```
flights/<name>/
  TASK.md        what the agent is asked to do (shown on /flights)
  flight.json    { "title", "vendor", "surface", "description" }
  check.mjs      exits 0 only when the trap is fixed
  <the trap>     the broken file or files
  .orig/         an identical copy of everything above
```

Rules:

- `node check.mjs` must fail before the agent starts and pass once the trap
  is fixed properly. Make the check hard to cheat: the Stripe scenario sends
  a tampered payload that must still be rejected.
- `TASK.md` starts with a `# Title`, says what is broken, tells the agent to
  make `node check.mjs` pass and not to change `check.mjs`.
- Everything runs offline. Scenarios import SDKs from this repository's
  `node_modules` (the runner links it into the working copy), so use only
  packages already installed. No accounts, no network.
- `vendor` and `surface` in `flight.json` are what the flight's summary stop signal
  is filed under.

Fly it, with and without Pioneer:

```bash
node scripts/test-flight.mjs --scenario <name> --runs 3
node scripts/test-flight.mjs --scenario <name> --runs 3 --no-pioneer   # control
```

This needs the `claude` CLI on your PATH, signed in. Stop signals from a test
flight are labelled `harvest`.

## Code style

- TypeScript, strict. Next.js 16 App Router with React 19: `params` and
  `searchParams` are Promises. Read `node_modules/next/dist/docs/` rather
  than guessing.
- Server components and route handlers read through `lib/data.ts`. Client
  components call the HTTP API or use `supabaseBrowser()` for Realtime.
- Rules about who may write what belong in a SQL function, not only in a
  route handler. New migrations go in `supabase/migrations/` with the next
  number; never edit a migration that has shipped.
- Validate every request body with zod and cap every length.
- Comments are short and plain and explain why, not what.
- UI follows the black-and-honey design language in
  [docs/DESIGN.md](docs/DESIGN.md): black field, hairlines, square corners,
  honey as the single accent, colour otherwise reserved for data. No emoji,
  no placeholder buttons, no fake data in components.
- Avoid new dependencies; make the case in the pull request if you need one.

## The one rule that has no exceptions

**Data sources are always labelled.** Every stop signal, flare and rescue carries a
`source`:

| Source | Meaning |
|---|---|
| `live` | Reported by a real agent through the hook, MCP or the API |
| `harvest` | Produced by a test flight |
| `seed` | Charted from known failure patterns by `scripts/seed.ts` |

Any screen, tool output or document that shows a count, a flare or a rating
must make clear which of these it comes from. Never present seeded numbers as
live traffic, and never write a row without the right `source`.
