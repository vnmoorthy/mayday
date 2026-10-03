import type { Attempt } from "@/lib/types";

// Ready-made incidents for the cockpit. The error text is what each product
// really emits; the black box is what an agent typically tries before giving up.
// The first one is HivePay, a fictional vendor: its rule is in no model's
// training data, which is the kind of failure Pioneer exists for.

export type VendorChoice = "auto" | "hivepay" | "stripe" | "supabase" | "vercel" | "anthropic";

export const VENDOR_CHOICES: { value: VendorChoice; label: string }[] = [
  { value: "auto", label: "Auto-detect" },
  { value: "hivepay", label: "HivePay (fictional)" },
  { value: "stripe", label: "Stripe" },
  { value: "supabase", label: "Supabase" },
  { value: "vercel", label: "Vercel" },
  { value: "anthropic", label: "Anthropic" },
];

export type Scenario = {
  id: string;
  vendor: Exclude<VendorChoice, "auto">;
  label: string;
  surface: string;
  error: string;
  attempts: Attempt[];
  minutes_lost: number;
};

export const SCENARIOS: Scenario[] = [
  {
    id: "hivepay-minor-units",
    vendor: "hivepay",
    label: "Undocumented minor-units rule",
    surface: "payouts.create",
    error: "HivePayError [HP_AMOUNT_MINOR_UNITS]: amount must be an integer number of minor units",
    attempts: [
      { step: 1, action: "Called hivepay.payouts.create({ amount: 12.5, currency: 'usd' }) as the published docs show", result: "HP_AMOUNT_MINOR_UNITS: amount must be an integer number of minor units" },
      { step: 2, action: "Passed the amount as the string '12.50'", result: "Same error: the docs never say the amount is counted in minor units" },
    ],
    minutes_lost: 16,
  },
  {
    id: "stripe-webhook-raw-body",
    vendor: "stripe",
    label: "Webhook signature, raw body",
    surface: "webhooks.constructEvent",
    error: [
      "StripeSignatureVerificationError: No signatures found matching the expected signature for payload. Are you passing the raw request body you received from Stripe?",
      " If a webhook request is being forwarded by a third-party tool, ensure that the exact request body, including JSON formatting and new line style, is preserved.",
      "",
      "Learn more about webhook signing and explore webhook integration examples for various frameworks at https://docs.stripe.com/webhooks/signature",
      "    at Object.verifyHeader (node_modules/stripe/esm/Webhooks.js:112:19)",
      "    at POST (app/api/stripe/webhook/route.ts:14:34)",
    ].join("\n"),
    attempts: [
      { step: 1, action: "Called stripe.webhooks.constructEvent(await req.json(), signature, secret)", result: "No signatures found matching the expected signature for payload" },
      { step: 2, action: "Rolled the whsec_ signing secret and redeployed", result: "Same error" },
      { step: 3, action: "Passed JSON.stringify(body) instead of the parsed object", result: "Same error: re-serialised JSON is not byte-identical to what Stripe signed" },
    ],
    minutes_lost: 18,
  },
  {
    id: "stripe-no-such-price",
    vendor: "stripe",
    label: "No such price, wrong mode",
    surface: "checkout.sessions.create",
    error: [
      "StripeInvalidRequestError: No such price: 'price_1QK8sYLkdIwHu7ixOQy0Hd3T'; a similar object exists in live mode, but a test mode key was used to make this request.",
      "  type: 'StripeInvalidRequestError',",
      "  code: 'resource_missing',",
      "  param: 'line_items[0][price]',",
      "  statusCode: 400,",
      "  requestId: 'req_9cFz2pXw71LmQa'",
    ].join("\n"),
    attempts: [
      { step: 1, action: "Created a Checkout Session with the price id copied from the dashboard", result: "400 resource_missing: No such price" },
      { step: 2, action: "Copied the price id again and retried", result: "Same error: the dashboard was in live mode, the key is a test key" },
    ],
    minutes_lost: 9,
  },
  {
    id: "supabase-rls-insert",
    vendor: "supabase",
    label: "RLS blocks the insert",
    surface: "postgrest insert",
    error: [
      "{",
      "  code: '42501',",
      "  details: null,",
      "  hint: null,",
      "  message: 'new row violates row-level security policy for table \"profiles\"'",
      "}",
    ].join("\n"),
    attempts: [
      { step: 1, action: "supabase.from('profiles').insert({ id: user.id, name }) with the anon key", result: "42501 new row violates row-level security policy" },
      { step: 2, action: "Added a SELECT policy for authenticated users", result: "Same error: there is no INSERT policy with a WITH CHECK clause" },
      { step: 3, action: "Retried after signing the user in", result: "Same error: the server client was created without the user's session" },
    ],
    minutes_lost: 14,
  },
  {
    id: "supabase-pgrst116",
    vendor: "supabase",
    label: "PGRST116 on .single()",
    surface: "postgrest .single()",
    error: [
      "{",
      "  code: 'PGRST116',",
      "  details: 'The result contains 0 rows',",
      "  hint: null,",
      "  message: 'Cannot coerce the result to a single JSON object'",
      "}",
    ].join("\n"),
    attempts: [
      { step: 1, action: "supabase.from('subscriptions').select('*').eq('user_id', id).single()", result: "406 PGRST116: The result contains 0 rows" },
      { step: 2, action: "Retried with the service role key", result: "Same error: the row does not exist yet for a new user" },
    ],
    minutes_lost: 7,
  },
  {
    id: "vercel-params-awaited",
    vendor: "vercel",
    label: "Next.js params not awaited",
    surface: "next.js dynamic route params",
    error: [
      'Error: Route "/site/[slug]" used `params.slug`. `params` should be awaited before using its properties. Learn more: https://nextjs.org/docs/messages/sync-dynamic-apis',
      "    at SitePage (app/site/[slug]/page.tsx:8:33)",
    ].join("\n"),
    attempts: [
      { step: 1, action: "Generated a page component that reads params.slug synchronously", result: "`params` should be awaited before using its properties" },
      { step: 2, action: "Destructured { slug } in the function signature", result: "Same error: params is a Promise in this Next.js version" },
    ],
    minutes_lost: 6,
  },
  {
    id: "vercel-dynamic-server-usage",
    vendor: "vercel",
    label: "Dynamic server usage at build",
    surface: "next build static generation",
    error: [
      "Error: Dynamic server usage: Route /dashboard couldn't be rendered statically because it used `cookies`. See more info here: https://nextjs.org/docs/messages/dynamic-server-error",
      "    at async DashboardLayout (app/dashboard/layout.tsx:11:23) {",
      "  description: \"Route /dashboard couldn't be rendered statically because it used `cookies`. See more info here: https://nextjs.org/docs/messages/dynamic-server-error\",",
      "  digest: 'DYNAMIC_SERVER_USAGE'",
      "}",
    ].join("\n"),
    attempts: [
      { step: 1, action: "Ran next build with cookies() called inside a try/catch in the layout", result: "Dynamic server usage: Route /dashboard couldn't be rendered statically" },
      { step: 2, action: "Added 'use server' to the top of the file", result: "Same error: the catch block swallows the bailout signal Next.js throws" },
    ],
    minutes_lost: 11,
  },
  {
    id: "anthropic-tool-use-without-result",
    vendor: "anthropic",
    label: "tool_use without tool_result",
    surface: "messages api tool use",
    error:
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"messages.2: `tool_use` ids were found without `tool_result` blocks immediately after: toolu_01A09q90qw90lq917835lq9. Each `tool_use` block must have a corresponding `tool_result` block in the next message."}}',
    attempts: [
      { step: 1, action: "Appended the assistant tool_use turn, then a plain user text message", result: "400 `tool_use` ids were found without `tool_result` blocks immediately after" },
      { step: 2, action: "Sent the tool output as a text block", result: "Same error: it must be a tool_result block carrying the matching tool_use_id" },
    ],
    minutes_lost: 12,
  },
  {
    id: "anthropic-empty-text-block",
    vendor: "anthropic",
    label: "Empty text content block",
    surface: "messages api content blocks",
    error:
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"messages: text content blocks must be non-empty"}}',
    attempts: [
      { step: 1, action: "Replayed the conversation history, including an assistant turn whose text was empty", result: "400 messages: text content blocks must be non-empty" },
      { step: 2, action: "Trimmed whitespace from every text block", result: "Same error: the empty block has to be dropped, not trimmed" },
    ],
    minutes_lost: 5,
  },
];
