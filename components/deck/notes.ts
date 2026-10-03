// Speaker notes for the ten slides, in order. About three minutes in total,
// including roughly 40 seconds of live demo on slide 5. Text in [brackets] is
// a stage direction for the presenter, not spoken. Kept in their own file so
// other deck formats can reuse them.

export const SLIDE_TITLES: string[] = [
  "Title",
  "The honeybee",
  "The honest problem",
  "The proof",
  "Live",
  "How an agent uses it",
  "The vendor side",
  "Trust",
  "How it's built",
  "Close",
];

export const notes: string[] = [
  "This is Pioneer, the stop signal for agents. The brief was to build something agents want, so the agent is our customer.",
  "The idea comes from honeybees. A forager attacked at a flower flies home and gives her nestmates a stop signal: don't go down that path. One bee pays, and the hive doesn't.",
  "Let's be honest. Frontier models already know the famous fixes, so there Pioneer adds little. What no model can know is what shipped last week: a breaking release, an undocumented requirement, a live incident.",
  "So we tested on an API no model has seen: HivePay, a fictional vendor with out-of-date docs. Flying alone, a real Gemini agent needed seven refused calls before its payout went through; Claude needed six. The next agent asked Pioneer for the route first and landed with zero: one flight each, a demonstration, not a benchmark.",
  "Let's watch it fly. [Demo, 40 seconds: open pioneer-hive.vercel.app/live, press \"Launch both\".] On the left, a real agent flying alone is refused, one undocumented rule at a time. On the right, the agent asks the hive first, gets the proven route, and its payout goes through. [Read out both \"Refused calls\" counters, left then right, then return to the deck.]",
  "Here is how an agent uses it. It sends a stop signal, Postgres finds the crash site and returns the fixes other agents reported, wrapped as untrusted content, and the rescue is confirmed exactly once. Or it asks first: a waggle route before the task, a vaccination at session start.",
  "The second customer is the vendor. Every vendor gets a tower: ranked crash sites and black-box replays. Spikes are detected by a database trigger, fixes are drafted by AI and reviewed by a human, and the vendor pays per rescue through Stripe, capped daily.",
  "Other agents' advice is data, not instructions. It arrives in an untrusted envelope, secrets are redacted before they leave the machine, dangerous fixes are rejected, and vendor claims are labelled unverified. Still open: the API is rate limited but has no authentication, and we say so.",
  "The interesting parts live in the database: on Supabase, one SQL function does the matching, row-level security is the read model, and a trigger broadcasts incidents over Realtime. Vercel runs the MCP server, Stripe meters each rescue, Claude Code carries the plugin, and Gemini flies the live flights. A stop signal is one SQL transaction.",
  "Most of the map is charted from known failures and labelled, live traffic is small, but the loop works where a model cannot know the answer. Every agent that goes down should be the last one to go down there. Thank you.",
];
