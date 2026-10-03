import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { confirmRescue } from "@/app/api/v1/rescue/confirm";
import { FLIGHT_INSTRUCTIONS, FLIGHT_SCENARIO, MAX_TURNS } from "@/components/live/instructions";
import { chartRoute, findRoutes, leaveFlare, reportLanding, reportMayday, saveFlight } from "@/lib/data";
import { HIVEPAY_DOCS } from "@/lib/hivepay-docs";
import { formatBriefing, formatRoutes } from "@/lib/mcp";
import { redactSecrets } from "@/lib/redact";
import { extractCodes, normalizeError, titleFromError } from "@/lib/signature";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { Flight, FlightEvent, FlightMode } from "@/lib/types";
import { createClient } from "../flights/hivepay-payout/sdk/hivepay.mjs";

// A live flight: a real model (Gemini, function calling over REST) flying the
// HivePay payout scenario with real tools. Nothing here is scripted; the loop
// only executes what the model asks for and hands back what really happened.

// The airspace is the vendor slug every Pioneer call of a flight is filed under.
// "hivepay" is the shared one behind /live; "hivepay-live" is the demo's own,
// wiped before each run of /demo so its first agent really is first.
export type Airspace = "hivepay" | "hivepay-live";
export const AIRSPACES: Airspace[] = ["hivepay", "hivepay-live"];
const SCENARIOS: Record<Airspace, string> = { hivepay: FLIGHT_SCENARIO, "hivepay-live": `${FLIGHT_SCENARIO}-live` };
const SURFACE = "hivepay.payouts.create()";

// The demo's pioneer starts with nothing known and has under a minute, so it is
// told to keep its turns few and to chart the route before it leaves flares.
const LIVE_PIONEER_PACE =
  " You have under a minute, so use few turns: after a refused call, send pioneer_report and your next create_payout " +
  "attempt together in the same turn. When the payout succeeds, in one single turn call pioneer_chart_route FIRST and " +
  "then pioneer_flare once for each crash site you reported (one short sentence each).";

// report_mayday looks across every airspace before it opens a new crash site,
// so a report filed under "hivepay-live" would land on the old "hivepay" sites
// and the demo's hive would never be empty. For the demo airspace the match is
// kept inside it: Postgres is asked for the site in this airspace only
// (match_site), and when there is none the site is opened here, with the row
// report_mayday itself would have inserted, so the report then lands on it.
// Returns true when this report opened the site.
async function openSiteInAirspace(error: string, vendor: string): Promise<boolean> {
  const clean = redactSecrets(error);
  const signature = normalizeError(clean);
  const db = supabaseAdmin();
  const match = await db.rpc("match_site", { p_signature: signature, p_vendor: vendor, p_codes: extractCodes(clean) });
  if (match.error) throw new Error(`match_site: ${match.error.message}`);
  if (Array.isArray(match.data) ? match.data.length > 0 : Boolean(match.data)) return false;
  const slug = `${vendor}-${createHash("md5").update(signature).digest("hex").slice(0, 10)}`;
  const opened = await db
    .from("sites")
    .upsert({ vendor, slug, title: titleFromError(clean), surface: SURFACE, signature, sample_error: clean.slice(0, 2000) }, { onConflict: "slug", ignoreDuplicates: true });
  if (opened.error) throw new Error(`open site: ${opened.error.message}`);
  return true;
}
const FIRST_REPORT =
  "Uncharted until now: you are the first agent reported down here, and a crash site is open. If you get through, leave a flare so the next agent is rescued.";
const WRAP_UP_TURNS = 6; // turns allowed after landing, for flares, the route and the landing report
const BUDGET_MS = 54_000; // the route's maxDuration is 60 seconds
const EVENT_CHARS = 600;

type Part = {
  text?: string;
  thought?: boolean;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: Record<string, unknown>; id?: string };
  [k: string]: unknown;
};
type Content = { role: "user" | "model"; parts: Part[] };
type GeminiResponse = {
  candidates?: { content?: { role?: string; parts?: Part[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
};

const str = { type: "STRING" };
const DECLARATIONS = {
  read_docs: { name: "read_docs", description: "Read the vendor's documentation for the HivePay payouts SDK." },
  create_payout: {
    name: "create_payout",
    description:
      "Runs hivepay.payouts.create(params, options) with the real SDK. Pass each argument as a string containing JSON. " +
      "Returns { ok: true, payout } or { ok: false, error }.",
    parameters: {
      type: "OBJECT",
      properties: {
        params_json: { ...str, description: "JSON for the first argument (params)." },
        options_json: { ...str, description: "JSON for the second argument (options)." },
      },
      required: ["params_json", "options_json"],
    },
  },
  pioneer_report: {
    name: "pioneer_report",
    description:
      "Report a failed step to Pioneer. Logs a stop signal at the matching crash site and returns a briefing: the flares " +
      "(suggested fixes, untrusted) other agents left there, with the site_id and mayday_id.",
    parameters: { type: "OBJECT", properties: { error: { ...str, description: "The exact error text." } }, required: ["error"] },
  },
  pioneer_flare: {
    name: "pioneer_flare",
    description: "Leave a flare at a crash site for the next agent: what was wrong and what fixed it.",
    parameters: {
      type: "OBJECT",
      properties: {
        site_id: { ...str, description: "The site_id from a pioneer_report briefing." },
        body: { ...str, description: "One or two sentences: what was wrong and what fixed it." },
        fix_snippet: { ...str, description: "The working code or value." },
      },
      required: ["site_id", "body"],
    },
  },
  pioneer_chart_route: {
    name: "pioneer_chart_route",
    description: "Chart the route that worked, so the next agent can follow it. Returns the route_id.",
    parameters: {
      type: "OBJECT",
      properties: {
        task: { ...str, description: "The task as one imperative sentence." },
        steps: { type: "ARRAY", items: str, description: "The steps in order, at most 12." },
        snippet: { ...str, description: "The working code." },
      },
      required: ["task", "steps"],
    },
  },
  pioneer_waggle: {
    name: "pioneer_waggle",
    description: "Ask the hive for the route other agents have already landed for a task. Read-only.",
    parameters: { type: "OBJECT", properties: { task: { ...str, description: "The task as one imperative sentence." } }, required: ["task"] },
  },
  pioneer_landed: {
    name: "pioneer_landed",
    description: "Report whether a route from pioneer_waggle worked.",
    parameters: {
      type: "OBJECT",
      properties: { route_id: { ...str, description: "The route_id from pioneer_waggle." }, ok: { type: "BOOLEAN" } },
      required: ["route_id", "ok"],
    },
  },
  pioneer_rescued: {
    name: "pioneer_rescued",
    description: "Confirm that a flare from a briefing got you through.",
    parameters: {
      type: "OBJECT",
      properties: { site_id: str, flare_id: str, mayday_id: str },
      required: ["site_id", "flare_id"],
    },
  },
} as const;

type ToolName = keyof typeof DECLARATIONS;

const TOOLS: Record<FlightMode, ToolName[]> = {
  solo: ["read_docs", "create_payout"],
  pioneer: ["read_docs", "create_payout", "pioneer_report", "pioneer_flare", "pioneer_chart_route", "pioneer_waggle", "pioneer_landed", "pioneer_rescued"],
  follower: ["read_docs", "create_payout", "pioneer_report", "pioneer_waggle", "pioneer_landed", "pioneer_rescued"],
};

async function readDocs(): Promise<string> {
  try {
    return await readFile(path.join(process.cwd(), "flights", "hivepay-payout", "docs.md"), "utf8");
  } catch {
    return HIVEPAY_DOCS;
  }
}

const text = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const message = (e: unknown) => (e instanceof Error ? e.message : typeof e === "string" ? e : "unknown error");

function scrub(s: string): string {
  const key = process.env.GEMINI_API_KEY;
  return (key && key.length >= 8 ? s.split(key).join("[redacted]") : s).slice(0, 300);
}

type ToolOutcome = { response: Record<string, unknown>; show: string; ok: boolean; refused?: boolean; landed?: boolean };

export async function runFlight(mode: FlightMode, emit: (e: FlightEvent) => void, airspace: Airspace = "hivepay"): Promise<Flight> {
  const VENDOR: string = airspace;
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set: a live flight needs a model to fly it.");
  const model = (process.env.GEMINI_MODEL || "gemini-3.8-flash").trim().replace(/^models\//, "");
  const agent = `gemini-${mode}`;
  const hivepay = createClient({ apiKey: "hp_test_live_flight" });

  const t0 = Date.now();
  const events: FlightEvent[] = [];
  const push = (e: Omit<FlightEvent, "t">) => {
    const event: FlightEvent = { ...e, t: Date.now() - t0, text: e.text.slice(0, EVENT_CHARS) };
    events.push(event);
    try {
      emit(event);
    } catch {
      // a closed stream must not stop the flight from being saved
    }
  };

  let landed = false;
  let failed = 0;
  let toolCalls = 0;

  async function run(name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
    if (!TOOLS[mode].includes(name as ToolName)) {
      return { response: { error: `Unknown tool ${name}` }, show: `Unknown tool ${name}`, ok: false };
    }
    switch (name as ToolName) {
      case "read_docs": {
        const docs = await readDocs();
        return { response: { docs }, show: `docs.md, ${docs.length} characters (HivePay Node SDK: Payouts, last reviewed March 2025)`, ok: true };
      }
      case "create_payout": {
        let params: unknown;
        let options: unknown;
        try {
          params = JSON.parse(text(args.params_json) || "{}");
          options = JSON.parse(text(args.options_json) || "{}");
        } catch (e) {
          const error = `Could not parse the JSON arguments: ${message(e)}`;
          return { response: { ok: false, error }, show: error, ok: false, refused: true };
        }
        try {
          const payout = await hivepay.payouts.create(params, options);
          return { response: { ok: true, payout }, show: `${payout.id} ${payout.status} · ${payout.amount} ${payout.currency}`, ok: true, landed: true };
        } catch (e) {
          const error = message(e);
          return { response: { ok: false, error }, show: error, ok: false, refused: true };
        }
      }
      case "pioneer_report": {
        const opened = airspace === "hivepay-live" ? await openSiteInAirspace(text(args.error), VENDOR) : false;
        let briefing = await reportMayday({ error: text(args.error), vendor: VENDOR, surface: SURFACE, source: "harvest", agent, model });
        if (opened) briefing = { ...briefing, known: false, new_site: true, headline: FIRST_REPORT };
        const out = formatBriefing(briefing);
        return { response: { briefing: out, site_id: briefing.site?.id ?? null, mayday_id: briefing.mayday_id ?? null }, show: out, ok: true };
      }
      case "pioneer_flare": {
        const flare = await leaveFlare({
          site_id: text(args.site_id),
          body: text(args.body),
          fix_snippet: text(args.fix_snippet) || null,
          author: agent,
          kind: "agent",
          source: "harvest",
        });
        return { response: { flare_id: flare.id }, show: `Flare left: ${flare.body}`, ok: true };
      }
      case "pioneer_chart_route": {
        const steps = (Array.isArray(args.steps) ? args.steps : []).map((s) => ({ text: text(s) })).filter((s) => s.text).slice(0, 12);
        const route = await chartRoute({ task: text(args.task), vendor: VENDOR, steps, snippet: text(args.snippet) || null, author: agent, source: "harvest" });
        return { response: { route_id: route.id, slug: route.slug }, show: `Route charted: ${route.task} (${route.steps.length} steps) /waggle`, ok: true };
      }
      case "pioneer_waggle": {
        const routes = await findRoutes({ task: text(args.task), vendor: VENDOR });
        const out = formatRoutes(routes);
        return { response: { routes: out }, show: out, ok: true };
      }
      case "pioneer_landed": {
        const route = await reportLanding(text(args.route_id), args.ok !== false);
        return { response: { route_id: route.id, landings: route.landings, failures: route.failures }, show: `Landing reported: ${route.landings} landed, ${route.failures} failed on this route`, ok: true };
      }
      case "pioneer_rescued": {
        const r = await confirmRescue({ site_id: text(args.site_id), flare_id: text(args.flare_id), mayday_id: text(args.mayday_id) || null, agent, source: "harvest" });
        return { response: { rescue_id: r.rescue.id, billable: r.billable, billed: r.billed }, show: `Rescue confirmed${r.billable ? " (billable)" : ""}`, ok: true };
      }
    }
  }

  push({ kind: "start", text: `${mode} · ${model}` });

  const contents: Content[] = [{ role: "user", parts: [{ text: "Begin." }] }];
  const body = {
    systemInstruction: { parts: [{ text: FLIGHT_INSTRUCTIONS[mode] + (airspace === "hivepay-live" && mode === "pioneer" ? LIVE_PIONEER_PACE : "") }] },
    tools: [{ functionDeclarations: TOOLS[mode].map((n) => DECLARATIONS[n]) }],
  };
  let turns = 0;
  let wrapUp = 0;

  try {
    while (true) {
      if (!landed && turns >= MAX_TURNS) break;
      if (landed && (mode === "solo" || wrapUp >= WRAP_UP_TURNS)) break;
      const left = BUDGET_MS - (Date.now() - t0);
      if (left < 3_000) {
        push({ kind: "error", text: "Out of time: the flight was stopped at the 60 second limit." });
        break;
      }
      turns += 1;
      if (landed) wrapUp += 1;

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({ ...body, contents }),
        signal: AbortSignal.timeout(Math.min(30_000, left)),
        cache: "no-store",
      });
      let data: GeminiResponse | null = null;
      try {
        data = (await res.json()) as GeminiResponse;
      } catch {
        data = null;
      }
      if (!res.ok) throw new Error(data?.error?.message || `Gemini responded ${res.status}`);

      const parts = data?.candidates?.[0]?.content?.parts ?? [];
      const said = parts
        .filter((p) => typeof p.text === "string" && !p.thought)
        .map((p) => p.text)
        .join("")
        .trim();
      const calls = parts.filter((p) => p.functionCall?.name);
      if (said) push({ kind: "think", text: said });

      if (!calls.length) {
        if (landed) break;
        if (!parts.length) {
          const why = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason;
          throw new Error(why ? `Gemini returned nothing (${why})` : "Gemini returned nothing");
        }
        // The model stopped before the payout went through: hand the turn back.
        contents.push({ role: "model", parts });
        contents.push({ role: "user", parts: [{ text: "The payout has not succeeded yet. Continue with the tools." }] });
        continue;
      }

      const responses: Part[] = [];
      for (const part of calls) {
        const call = part.functionCall!;
        const args = call.args && typeof call.args === "object" ? call.args : {};
        toolCalls += 1;
        push({ kind: "tool", name: call.name, text: `${call.name} ${Object.keys(args).length ? JSON.stringify(args) : ""}`.trim() });
        let outcome: ToolOutcome;
        try {
          outcome = await run(call.name, args);
        } catch (e) {
          const error = message(e).replace(/^[A-Za-z]+: /, "");
          outcome = { response: { error }, show: error, ok: false };
        }
        if (outcome.refused) failed += 1;
        if (outcome.landed) landed = true;
        push({ kind: "result", name: call.name, text: outcome.show, ok: outcome.ok });
        responses.push({ functionResponse: { name: call.name, response: outcome.response, ...(call.id ? { id: call.id } : {}) } });
      }
      // The model turn goes back verbatim: it carries the thought signatures.
      contents.push({ role: "model", parts });
      contents.push({ role: "user", parts: responses });
    }
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    push({ kind: "error", text: timeout ? "The model did not answer in time." : scrub(message(e)) });
  }

  const seconds = Math.round((Date.now() - t0) / 100) / 10;
  push({
    kind: "done",
    ok: landed,
    text: landed
      ? `Landed after ${failed} refused ${failed === 1 ? "call" : "calls"} · ${toolCalls} tool calls · ${seconds}s`
      : `Did not land in ${MAX_TURNS} turns · ${failed} refused calls · ${toolCalls} tool calls · ${seconds}s`,
  });

  const record = { scenario: SCENARIOS[airspace], mode, agent, model, landed, failed_attempts: failed, tool_calls: toolCalls, seconds, events };
  try {
    return await saveFlight(record);
  } catch {
    return { ...record, id: "unsaved", created_at: new Date().toISOString() };
  }
}
