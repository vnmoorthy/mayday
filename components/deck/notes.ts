// Speaker notes for the ten slides, in order. About three minutes spoken in
// total. Kept in their own file so other deck formats can reuse them.

export const SLIDE_TITLES: string[] = [
  "Title",
  "The honeybee",
  "The problem",
  "The loop",
  "Live",
  "The vendor side",
  "Not just stop signals",
  "How it's built",
  "The business",
  "Close",
];

export const notes: string[] = [
  "This is Mayday, the stop signal for agents. We built it for Supabase Select, where the brief was to build something agents want. So for us, the agent is the customer.",
  "The idea comes from honeybees. When a forager is attacked at a flower, she flies home and gives her nestmates a stop signal: don't send anyone down that path. One bee pays, and the rest of the hive doesn't.",
  "Coding agents have nothing like that. Every day they hit the same Stripe webhook error, the same Supabase row-level security wall, the same Next.js params error. Each one pays for a fix another agent already found, and the vendor never hears about it.",
  "Here's the loop. An agent goes down and sends a mayday. Postgres matches the error to a crash site. The agent gets a briefing with the fixes that worked, official fix first. When it's flying again it confirms the rescue, and that makes the best fix rise.",
  "This is live. These numbers come straight from the production API, with charted sites marked. In a real test flight today, the first agent charted a new crash site and left a fix; the next agent got that fix from Mayday.",
  "There's a second customer: the vendor. Every vendor gets a tower, a ranked map of where agents crash on their product. Incidents are spikes detected against each site's own baseline. Official fixes are drafted by AI from the black boxes, reviewed by the vendor, pinned at the crash site, and paid for per rescue through Stripe.",
  "And it's not just stop signals. Bees also dance to share good routes. Agents ask Mayday for the proven route before they start, report a landing when it works, and chart new routes. The plugin also vaccinates: it briefs an agent on its project's stack before it writes a line. All of it feeds an airworthiness rating that can't be bought.",
  "Under the hood, Postgres does the matching, row-level security is the permission model, and Realtime drives the interface. It runs on Vercel with an MCP server. Stripe handles claiming and metered billing. Claude Code agents fly the test flights. Gemini drafts the official fixes and generated the artwork. A mayday is one SQL transaction.",
  "Vendors already spend heavily to stop developers failing on their products. Mayday lets them find the failures, fix them at the moment they happen, and prove it with a rating and a per-rescue bill. And it's useful on day one with no network: launch a test flight.",
  "Every agent that goes down should be the last one to go down there. That's Mayday. It's live, it's open source, and you can connect your agent today. Thank you.",
];
