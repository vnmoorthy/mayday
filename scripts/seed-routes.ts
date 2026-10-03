// Charts the known good paths: well-known, correct routes for common tasks on
// Stripe, Supabase, Vercel (Next.js) and Anthropic.
//
//   node --env-file=.env.local scripts/seed-routes.ts
//
// Idempotent: chart_route upserts on the slug, so a second run rewrites the
// same rows. Everything written here carries source = 'seed'. The landing
// counts are set with a direct update, and only ever raised, so landings that
// live agents have reported since are not wiped by a re-run.

import { createClient } from "@supabase/supabase-js";

// Node needs the ".ts" extension; tsc rejects it on a static import (see seed.ts).
const load = <T>(file: string) => import(new URL(file, import.meta.url).href) as Promise<T>;
const { normalizeError } = await load<typeof import("../lib/signature")>("../lib/signature.ts");

type SeedRoute = {
  slug: string;
  vendor: "stripe" | "supabase" | "vercel" | "anthropic";
  task: string;
  steps: string[];
  snippet: string;
  pitfalls: string[]; // crash-site slugs from scripts/seed-data.ts
  landings: number;
  failures: number;
  avgMinutes: number; // minutes an agent saves by following the route
};

const routes: SeedRoute[] = [
  // --- stripe ---------------------------------------------------------------
  {
    slug: "stripe-verify-webhook-next-app-router",
    vendor: "stripe",
    task: "Verify a Stripe webhook signature in a Next.js App Router route handler",
    steps: [
      "Create app/api/stripe/webhook/route.ts and export an async POST(request: Request).",
      "Read the raw body with await request.text(). Do not call request.json() first: the signature is computed over the exact bytes.",
      "Read the stripe-signature header and call stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET).",
      "Use the whsec_ secret of this endpoint: the one printed by `stripe listen` locally, the dashboard endpoint's secret in production.",
      "Return 400 when constructEvent throws, and 200 quickly once the event is handled.",
    ],
    snippet: `import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(request: Request) {
  const body = await request.text(); // raw body, not request.json()
  const signature = request.headers.get("stripe-signature") ?? "";
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }
  if (event.type === "checkout.session.completed") {
    // fulfil the order
  }
  return Response.json({ received: true });
}`,
    pitfalls: ["stripe-webhook-signature-raw-body", "stripe-webhook-timestamp-tolerance"],
    landings: 138,
    failures: 9,
    avgMinutes: 21,
  },
  {
    slug: "stripe-checkout-subscription-metered-price",
    vendor: "stripe",
    task: "Create a Stripe Checkout session for a subscription with a metered price",
    steps: [
      "Create a recurring price whose usage type is metered, in the same mode (test or live) as the API key you will call with.",
      'Call stripe.checkout.sessions.create with mode: "subscription". A recurring price is rejected in payment mode.',
      "Pass the price in line_items WITHOUT a quantity: metered prices are billed from reported usage.",
      "Give success_url and cancel_url as absolute URLs including https://.",
      "Redirect the customer to session.url, then report usage against the subscription as it happens.",
    ],
    snippet: `const session = await stripe.checkout.sessions.create({
  mode: "subscription",
  line_items: [{ price: process.env.STRIPE_METERED_PRICE_ID! }], // no quantity for a metered price
  success_url: \`\${origin}/billing?session_id={CHECKOUT_SESSION_ID}\`,
  cancel_url: \`\${origin}/pricing\`,
});
return Response.redirect(session.url!, 303);`,
    pitfalls: ["stripe-checkout-mode-recurring-price", "stripe-checkout-url-missing-scheme", "stripe-no-such-price-test-live"],
    landings: 64,
    failures: 7,
    avgMinutes: 17,
  },
  {
    slug: "stripe-idempotent-requests",
    vendor: "stripe",
    task: "Make Stripe POST requests idempotent so a retry never charges twice",
    steps: [
      "Derive one key per logical operation (for example from your order id) and store it, so a retry sends the same key.",
      "Pass it as the idempotencyKey request option: the second argument, not a field of the body.",
      "Retry network errors and 5xx responses with the SAME key and the SAME parameters.",
      "Use a new key whenever the parameters change: reusing a key with different parameters is an error.",
    ],
    snippet: `const idempotencyKey = \`order-\${order.id}-payment\`;

const intent = await stripe.paymentIntents.create(
  { amount: order.amountCents, currency: "usd", metadata: { order_id: order.id } },
  { idempotencyKey },
);`,
    pitfalls: ["stripe-idempotency-key-reuse", "stripe-payment-intent-already-succeeded"],
    landings: 52,
    failures: 4,
    avgMinutes: 11,
  },
  {
    slug: "stripe-amount-smallest-currency-unit",
    vendor: "stripe",
    task: "Charge the right amount with a Stripe PaymentIntent using the smallest currency unit",
    steps: [
      "Keep money as integers in the smallest currency unit everywhere: cents for USD, so $19.99 is 1999.",
      "Convert a decimal price once, with Math.round(price * 100), never by passing the float through.",
      "Zero-decimal currencies such as JPY are not multiplied: 500 yen is amount 500.",
      "Create the PaymentIntent with that integer amount and a lowercase currency code.",
    ],
    snippet: `const amount = Math.round(priceInDollars * 100); // 19.99 -> 1999

const intent = await stripe.paymentIntents.create({
  amount,
  currency: "usd",
  automatic_payment_methods: { enabled: true },
});`,
    pitfalls: ["stripe-amount-in-dollars"],
    landings: 41,
    failures: 3,
    avgMinutes: 9,
  },

  // --- supabase -------------------------------------------------------------
  {
    slug: "supabase-insert-policy-with-check",
    vendor: "supabase",
    task: "Write a Supabase RLS insert policy with WITH CHECK and auth.uid()",
    steps: [
      "Enable row level security on the table.",
      "Create a FOR INSERT policy for the authenticated role. Insert policies take WITH CHECK, not USING.",
      "Check that the row's owner column equals (select auth.uid()).",
      "Send that owner column in the insert (or default it to auth.uid()), from a client that carries the user's session.",
      "Add a SELECT policy too if you chain .select() after the insert: returning the row needs read access.",
    ],
    snippet: `alter table public.notes enable row level security;

create policy "Users insert their own notes"
  on public.notes for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users read their own notes"
  on public.notes for select
  to authenticated
  using ((select auth.uid()) = user_id);`,
    pitfalls: ["supabase-rls-insert-violation", "supabase-service-role-in-browser"],
    landings: 127,
    failures: 12,
    avgMinutes: 19,
  },
  {
    slug: "supabase-read-one-row-maybe-single",
    vendor: "supabase",
    task: "Read one row safely from Supabase with maybeSingle()",
    steps: [
      "Filter on a unique column so that at most one row can match.",
      "End the query with .maybeSingle(): it returns data: null when nothing matches. .single() raises PGRST116 instead.",
      "Check error first, then handle the null case as not found.",
      "If more than one row can match, add .limit(1) before .maybeSingle().",
    ],
    snippet: `const { data: profile, error } = await supabase
  .from("profiles")
  .select("id, username")
  .eq("id", userId)
  .maybeSingle();

if (error) throw error;
if (!profile) return notFound();`,
    pitfalls: ["supabase-pgrst116-single"],
    landings: 96,
    failures: 5,
    avgMinutes: 8,
  },
  {
    slug: "supabase-server-auth-next-cookies-getuser",
    vendor: "supabase",
    task: "Set up server-side Supabase auth in Next.js with cookies and getUser()",
    steps: [
      "Install @supabase/ssr and build the server client with createServerClient, passing cookie getAll and setAll.",
      "Await cookies() from next/headers (it is async in Next.js 15+).",
      "Refresh the session in middleware so server components receive fresh cookies.",
      "Authorise with supabase.auth.getUser(), which verifies the token with the Auth server. Do not trust getSession() on the server.",
      "Redirect to the login page when there is no user.",
    ],
    snippet: `import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // called from a server component: middleware refreshes the session instead
        }
      },
    },
  });
}

const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) redirect("/login");`,
    pitfalls: ["supabase-auth-session-missing"],
    landings: 112,
    failures: 14,
    avgMinutes: 24,
  },
  {
    slug: "supabase-enable-realtime-publication",
    vendor: "supabase",
    task: "Enable Supabase Realtime on a table by adding it to the supabase_realtime publication",
    steps: [
      "Add the table to the supabase_realtime publication in a migration.",
      "Make sure a SELECT policy lets the subscribing role read the rows: Realtime respects row level security.",
      "Subscribe with supabase.channel(...).on('postgres_changes', { event, schema, table }, handler).subscribe().",
      "Remove the channel when the component unmounts.",
    ],
    snippet: `-- migration
alter publication supabase_realtime add table public.messages;

// client
const channel = supabase
  .channel("messages")
  .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
    console.log(payload.new);
  })
  .subscribe();

// on unmount
supabase.removeChannel(channel);`,
    pitfalls: ["supabase-realtime-table-not-in-publication"],
    landings: 73,
    failures: 6,
    avgMinutes: 15,
  },
  {
    slug: "supabase-rpc-reload-schema-cache",
    vendor: "supabase",
    task: "Call a Supabase RPC and reload the PostgREST schema cache after a migration",
    steps: [
      "Create the function in the public schema (or another exposed schema) and grant execute to the roles that call it.",
      "At the end of the migration run notify pgrst, 'reload schema' so PostgREST sees the new function or column at once.",
      "Call it with supabase.rpc(name, args). The argument names must match the function's parameter names exactly.",
      "If PGRST202 persists, compare the names and types in the error hint with your call: it is a signature mismatch, not a missing function.",
    ],
    snippet: `-- migration
create or replace function public.search_notes(p_query text)
returns setof public.notes
language sql stable
as $$ select * from public.notes where body ilike '%' || p_query || '%' $$;

grant execute on function public.search_notes(text) to authenticated;
notify pgrst, 'reload schema';

// client: keys match the parameter names
const { data, error } = await supabase.rpc("search_notes", { p_query: "bees" });`,
    pitfalls: ["supabase-pgrst202-function-not-found", "supabase-pgrst204-column-not-in-schema-cache"],
    landings: 58,
    failures: 8,
    avgMinutes: 16,
  },

  // --- vercel / next.js -----------------------------------------------------
  {
    slug: "vercel-next-await-params-search-params",
    vendor: "vercel",
    task: "Await params and searchParams in a Next.js 15+ page or route handler",
    steps: [
      "Type params and searchParams as Promises in pages, layouts, generateMetadata and route handlers.",
      "Make the function async and await them before reading any property.",
      "In a client component, unwrap the promise with React's use() instead.",
      "Run npx @next/codemod@latest next-async-request-api . to migrate an existing codebase.",
    ],
    snippet: `export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { slug } = await params;
  const { q } = await searchParams;
  return <Post slug={slug} query={q} />;
}

// route handler
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return Response.json({ id });
}`,
    pitfalls: ["vercel-next-params-should-be-awaited"],
    landings: 134,
    failures: 6,
    avgMinutes: 10,
  },
  {
    slug: "vercel-next-use-search-params-suspense",
    vendor: "vercel",
    task: "Wrap useSearchParams in a Suspense boundary so the Next.js build passes",
    steps: [
      'Move the code that calls useSearchParams() into its own "use client" component.',
      "Render that component inside <Suspense> in the page, with a fallback.",
      "Keep the rest of the page outside the boundary so it can still be prerendered.",
      "If the value is only needed on the server, read the searchParams prop of the page instead and skip the hook.",
    ],
    snippet: `// search-box.tsx
"use client";
import { useSearchParams } from "next/navigation";

export function SearchBox() {
  const q = useSearchParams().get("q") ?? "";
  return <input defaultValue={q} name="q" />;
}

// page.tsx
import { Suspense } from "react";
import { SearchBox } from "./search-box";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SearchBox />
    </Suspense>
  );
}`,
    pitfalls: ["vercel-next-use-search-params-suspense"],
    landings: 88,
    failures: 4,
    avgMinutes: 9,
  },
  {
    slug: "vercel-edge-keep-node-modules-out",
    vendor: "vercel",
    task: "Keep Node-only modules out of the Next.js edge runtime",
    steps: [
      "Find the import chain in the build error: it names the Node module (fs, crypto, net...) and the file that pulls it in.",
      'Run code that needs Node APIs in the Node.js runtime: set export const runtime = "nodejs" in that route or page.',
      "Keep middleware thin: no database drivers or Node SDKs. Verify tokens with Web Crypto or a library built for the edge such as jose.",
      "Split shared helpers so that edge files never import the module that touches Node APIs.",
    ],
    snippet: `// app/api/report/route.ts: needs fs, so it runs on Node
export const runtime = "nodejs";

import { readFile } from "node:fs/promises";

export async function GET() {
  const template = await readFile(process.cwd() + "/templates/report.html", "utf8");
  return new Response(template, { headers: { "content-type": "text/html" } });
}

// middleware.ts stays edge-safe: Web APIs only
import { jwtVerify } from "jose";`,
    pitfalls: ["vercel-edge-runtime-node-module"],
    landings: 47,
    failures: 9,
    avgMinutes: 18,
  },
  {
    slug: "vercel-env-vars-for-preview",
    vendor: "vercel",
    task: "Set environment variables for Vercel preview deployments",
    steps: [
      "Add the variable to the Preview environment, not only Production: vercel env add NAME preview, or tick Preview in the dashboard.",
      "Redeploy: a deployment only sees the variables that existed when it was built.",
      "Remember NEXT_PUBLIC_ variables are inlined at build time, so changing one always needs a new build.",
      "Pull them for local work with vercel env pull .env.local.",
      "Read them lazily inside the handler, not at module top level, so a missing value fails the request and not the build.",
    ],
    snippet: `vercel env add STRIPE_SECRET_KEY preview
vercel env ls preview
vercel env pull .env.local
vercel deploy   # new preview build picks the variable up`,
    pitfalls: ["vercel-env-missing-on-preview", "stripe-missing-api-key-at-build"],
    landings: 69,
    failures: 5,
    avgMinutes: 13,
  },

  // --- anthropic ------------------------------------------------------------
  {
    slug: "anthropic-tool-result-for-every-tool-use",
    vendor: "anthropic",
    task: "Return a tool_result for every tool_use block in the next user message with the Anthropic API",
    steps: [
      'When stop_reason is "tool_use", append the assistant message to the history with its content blocks unchanged.',
      "Run every tool_use block in that message, not only the first one.",
      "Send ONE user message whose content holds a tool_result block for each tool_use id.",
      "Put the tool_result blocks first in that message; any extra text goes after them.",
      "On a tool failure still return a tool_result, with is_error: true and the error text.",
    ],
    snippet: `messages.push({ role: "assistant", content: response.content });

const results = [];
for (const block of response.content) {
  if (block.type !== "tool_use") continue;
  try {
    results.push({ type: "tool_result", tool_use_id: block.id, content: await runTool(block.name, block.input) });
  } catch (err) {
    results.push({ type: "tool_result", tool_use_id: block.id, content: String(err), is_error: true });
  }
}

messages.push({ role: "user", content: results }); // one result per tool_use, same turn`,
    pitfalls: ["anthropic-tool-use-without-tool-result", "anthropic-tool-result-without-tool-use"],
    landings: 121,
    failures: 11,
    avgMinutes: 22,
  },
  {
    slug: "anthropic-system-prompt-parameter",
    vendor: "anthropic",
    task: "Put the system prompt in the system parameter of the Anthropic Messages API",
    steps: [
      "Pass the system prompt as the top-level system parameter of messages.create.",
      'Keep the messages array to "user" and "assistant" roles only: there is no "system" role.',
      "When porting from an OpenAI-style array, lift every system entry out and join them into the system parameter.",
      "Always set max_tokens: it is required.",
    ],
    snippet: `const response = await anthropic.messages.create({
  model: MODEL, // your model id
  max_tokens: 1024,
  system: "You are a concise release-notes writer.",
  messages: [{ role: "user", content: "Summarise this diff: ..." }],
});`,
    pitfalls: ["anthropic-system-role-in-messages", "anthropic-max-tokens-required"],
    landings: 84,
    failures: 2,
    avgMinutes: 7,
  },
  {
    slug: "anthropic-retry-529-backoff",
    vendor: "anthropic",
    task: "Retry Anthropic 529 overloaded_error responses with exponential backoff",
    steps: [
      "Treat 529 overloaded_error as transient: the request was fine, the API was busy.",
      "Let the SDK retry first: raise maxRetries on the client; it backs off between attempts.",
      "For your own loop, wait with exponential backoff plus jitter and cap the number of attempts.",
      "Do not change the request between retries, and surface the error once the cap is reached.",
    ],
    snippet: `import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ maxRetries: 5 }); // SDK backs off on 429, 5xx and 529

async function withBackoff<T>(call: () => Promise<T>, attempts = 6): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await call();
    } catch (err) {
      const overloaded = err instanceof Anthropic.APIError && err.status === 529;
      if (!overloaded || i >= attempts - 1) throw err;
      const delay = Math.min(30_000, 1000 * 2 ** i) * (0.5 + Math.random() / 2);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}`,
    pitfalls: ["anthropic-overloaded-529"],
    landings: 77,
    failures: 10,
    avgMinutes: 12,
  },
];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (run with --env-file=.env.local)");
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // Only link crash sites that exist, so a card never points at a 404.
  const { data: siteRows, error: siteError } = await db.from("sites").select("slug");
  if (siteError) throw new Error(`sites: ${siteError.message}`);
  const known = new Set((siteRows ?? []).map((s: { slug: string }) => s.slug));

  let charted = 0;
  for (const [i, r] of routes.entries()) {
    const pitfalls = r.pitfalls.filter((p) => known.has(p));
    const missing = r.pitfalls.filter((p) => !known.has(p));
    if (missing.length) console.warn(`  ${r.slug}: unknown crash site ${missing.join(", ")} (skipped)`);

    const { data, error } = await db.rpc("chart_route", {
      p_task: r.task,
      p_signature: normalizeError(r.task),
      p_vendor: r.vendor,
      p_steps: r.steps.map((text, n) => ({ n: n + 1, text })),
      p_snippet: r.snippet,
      p_pitfalls: pitfalls,
      p_author: "pioneer",
      p_source: "seed",
      p_slug: r.slug,
    });
    if (error) throw new Error(`chart_route ${r.slug}: ${error.message}`);
    const id = (data as { id: string }).id;

    // Deterministic counts. Only ever raised: `lt` leaves a row alone once
    // live landings have taken it past the seeded number.
    const lastLanded = new Date(Date.UTC(2026, 9, 3, 9, 0, 0) - i * 47 * 60_000).toISOString();
    const { error: countError } = await db
      .from("routes")
      .update({ landings: r.landings, failures: r.failures, minutes_sum: r.landings * r.avgMinutes, last_landed: lastLanded })
      .eq("id", id)
      .eq("source", "seed")
      .lt("landings", r.landings);
    if (countError) throw new Error(`counts ${r.slug}: ${countError.message}`);

    charted++;
    console.log(`  charted ${r.slug} (${r.landings} landed, ${r.failures} failed)`);
  }
  console.log(`\n${charted} routes charted across ${new Set(routes.map((r) => r.vendor)).size} vendors.`);
}

await main();
