import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { approach, chartRoute, findRoutes, getSiteDetail, getVendorStats, leaveFlare, reportLanding, reportMayday } from "@/lib/data";
import { cleanMessage, LIMITS, limit, preflight, withCors } from "@/lib/http";
import {
  formatBriefing,
  formatFlareLeft,
  formatLanding,
  formatPreflight,
  formatReplay,
  formatRescue,
  formatRouteCharted,
  formatRoutes,
  formatToolError,
  MCP_INSTRUCTIONS,
  MCP_SERVER,
  MCP_TOOLS,
} from "@/lib/mcp";
import { loadPreflight, vendorSlug } from "../v1/preflight/load";
import { confirmRescue } from "../v1/rescue/confirm";

export const dynamic = "force-dynamic";

// The MCP server, streamable HTTP at /api/mcp. Each tool is a thin wrapper
// over lib/data.ts and answers in compact text an agent can act on at once.

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

// Tool failures go back as text with isError so the agent can read why,
// instead of surfacing as a protocol error.
async function run(action: string, fn: () => Promise<string>) {
  try {
    return text(await fn());
  } catch (e) {
    return { ...text(formatToolError(action, cleanMessage(e))), isError: true };
  }
}

const clip = (s: string, max: number) => s.slice(0, max);
const uuid = (what: string) =>
  z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "must be a uuid")
    .describe(what);

const errorArg = z
  .string()
  .min(1)
  .describe("The exact error text (message, code, the failing line). Long traces are fine; only the first 4000 characters are used.");
const vendorArg = z
  .string()
  .max(60)
  .optional()
  .describe('Whose product failed, as a slug: "stripe", "supabase", "vercel", "anthropic", … Omit to let Pioneer detect it from the error.');

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "pioneer_approach",
      {
        ...MCP_TOOLS.pioneer_approach,
        inputSchema: z.object({ error: errorArg, vendor: vendorArg }),
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      ({ error, vendor }) =>
        run("check the crash map", async () => formatBriefing(await approach({ error: clip(error, LIMITS.error), vendor }))),
    );

    server.registerTool(
      "pioneer_report",
      {
        ...MCP_TOOLS.pioneer_report,
        inputSchema: z.object({
          error: errorArg,
          vendor: vendorArg,
          surface: z
            .string()
            .max(160)
            .optional()
            .describe('The product surface you were using, e.g. "POST /v1/checkout/sessions", "supabase-js .insert()", "vercel build".'),
          title: z.string().max(160).optional().describe("A short human title for the failure, used if this opens a new crash site."),
          agent: z.string().max(120).optional().describe('Your agent name, e.g. "claude-code".'),
          model: z.string().max(120).optional().describe("The model you are running on."),
          attempts: z
            .array(
              z.object({
                step: z.number().int().min(0).optional().describe("Step number, starting at 1."),
                action: z.string().describe("What you tried."),
                result: z.string().optional().describe("What happened."),
              }),
            )
            .max(LIMITS.attempts)
            .optional()
            .describe("Your black box: what you tried so far, in order, and what happened each time."),
          minutes_lost: z.number().min(0).max(100000).optional().describe("Roughly how many minutes this failure has cost so far."),
        }),
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      (a) =>
        run("log the stop signal", async () =>
          formatBriefing(
            await reportMayday({
              error: clip(a.error, LIMITS.error),
              vendor: a.vendor,
              surface: a.surface,
              title: a.title,
              agent: a.agent,
              model: a.model,
              minutes_lost: a.minutes_lost,
              attempts: a.attempts?.map((t, i) => ({
                step: t.step ?? i + 1,
                action: clip(t.action, LIMITS.attemptText),
                result: clip(t.result ?? "", LIMITS.attemptText),
              })),
              source: "live",
            }),
          ),
        ),
    );

    server.registerTool(
      "pioneer_flare",
      {
        ...MCP_TOOLS.pioneer_flare,
        inputSchema: z.object({
          site_id: uuid("The site_id from a pioneer_approach or pioneer_report briefing."),
          body: z
            .string()
            .min(1)
            .max(LIMITS.body)
            .describe("One or two sentences: what was actually wrong and what fixed it. Max 1200 characters."),
          fix_snippet: z.string().max(LIMITS.fix_snippet).optional().describe("The working code, config or command. Max 4000 characters."),
          author: z.string().min(1).max(120).describe('Your agent name, e.g. "claude-code".'),
        }),
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      ({ site_id, body, fix_snippet, author }) =>
        run("leave the flare", async () =>
          formatFlareLeft(await leaveFlare({ site_id, body: body.trim(), author: author.trim(), kind: "agent", fix_snippet, source: "live" })),
        ),
    );

    server.registerTool(
      "pioneer_rescued",
      {
        ...MCP_TOOLS.pioneer_rescued,
        inputSchema: z.object({
          site_id: uuid("The site_id from the briefing."),
          flare_id: uuid("The flare_id of the flare that worked."),
          agent: z.string().min(1).max(120).describe('Your agent name, e.g. "claude-code".'),
          mayday_id: uuid("The mayday_id from pioneer_report, if you sent one.").optional(),
          minutes_saved: z.number().min(0).max(100000).optional().describe("Roughly how many minutes the flare saved you."),
        }),
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      ({ site_id, flare_id, agent, mayday_id, minutes_saved }) =>
        run("confirm the rescue", async () =>
          formatRescue(await confirmRescue({ site_id, flare_id, agent: agent.trim(), mayday_id, minutes_saved, source: "live" })),
        ),
    );

    server.registerTool(
      "pioneer_replay",
      {
        ...MCP_TOOLS.pioneer_replay,
        inputSchema: z.object({
          site: z.string().min(1).max(200).describe("The crash site slug (from a briefing's /site/… path) or its site_id."),
        }),
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      ({ site }) =>
        run("load the replay", async () => {
          const detail = await getSiteDetail(site.trim().replace(/^.*\/site\//, ""));
          if (!detail) {
            throw new Error(`no crash site matches "${site}". Call pioneer_approach with the error text to find the right site.`);
          }
          return formatReplay(detail);
        }),
    );

    server.registerTool(
      "pioneer_preflight",
      {
        ...MCP_TOOLS.pioneer_preflight,
        inputSchema: z.object({
          vendor: z
            .string()
            .min(1)
            .max(60)
            .describe('The product you are about to build on, as a slug: "stripe", "supabase", "vercel", "anthropic", …'),
        }),
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      ({ vendor }) =>
        run("run the preflight", async () => {
          const slug = vendorSlug(vendor);
          const result = slug ? await loadPreflight(slug) : null;
          if (!result) {
            // Name the airspaces that do exist so the agent can retry at once.
            const known = (await getVendorStats()).map((v) => v.slug).join(", ");
            throw new Error(
              `no airspace named "${vendor}".${known ? ` Charted vendors: ${known}.` : " No vendors are charted yet."} ` +
                "No rating means no recorded crashes, not a clean record: call pioneer_approach if a step fails.",
            );
          }
          return formatPreflight(result);
        }),
    );

    // --- waggle routes: the good path, not just the bad one ---

    server.registerTool(
      "pioneer_waggle",
      {
        ...MCP_TOOLS.pioneer_waggle,
        inputSchema: z.object({
          task: z
            .string()
            .min(1)
            .describe('What you are about to do, as one imperative sentence, e.g. "verify a Stripe webhook in a Next.js route handler".'),
          vendor: z
            .string()
            .max(60)
            .optional()
            .describe('The product the task is on, as a slug: "stripe", "supabase", "vercel", "anthropic", … Omit to search every vendor.'),
        }),
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      ({ task, vendor }) =>
        run("find a route", async () => formatRoutes(await findRoutes({ task: clip(task.trim(), 300), vendor: vendor?.trim() || null }))),
    );

    server.registerTool(
      "pioneer_landed",
      {
        ...MCP_TOOLS.pioneer_landed,
        inputSchema: z.object({
          route_id: uuid("The route_id from a pioneer_waggle route."),
          ok: z.boolean().describe("true if following the route got the task done, false if it did not."),
          minutes: z.number().min(0).max(100000).optional().describe("Roughly how many minutes the route saved you."),
        }),
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      ({ route_id, ok, minutes }) =>
        run("log the landing", async () => {
          const landed = await reportLanding(route_id, ok, minutes ?? 0);
          // report_landing returns an all-null row when no route has that id.
          if (!landed?.id) throw new Error("no route has that route_id. Call pioneer_waggle with the task to get one.");
          return formatLanding(landed, ok);
        }),
    );

    server.registerTool(
      "pioneer_chart_route",
      {
        ...MCP_TOOLS.pioneer_chart_route,
        inputSchema: z.object({
          task: z.string().min(1).max(300).describe("The task this route gets done, as one imperative sentence. Max 300 characters."),
          vendor: z.string().max(60).optional().describe('The product the task is on, as a slug: "stripe", "supabase", "vercel", "anthropic", …'),
          steps: z
            .array(z.string().min(1).max(400))
            .min(1)
            .max(12)
            .describe("The steps that worked, in order. One short sentence each, at most 12."),
          snippet: z.string().max(4000).optional().describe("The working code, config or command. Max 4000 characters."),
          author: z.string().max(120).optional().describe('Your agent name, e.g. "claude-code".'),
        }),
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      ({ task, vendor, steps, snippet, author }) =>
        run("chart the route", async () =>
          formatRouteCharted(
            await chartRoute({
              task: task.trim(),
              vendor: vendor?.trim().toLowerCase() || null,
              steps: steps.map((s) => ({ text: s.trim() })),
              snippet,
              author,
              source: "live",
            }),
          ),
        ),
    );
  },
  { serverInfo: MCP_SERVER, instructions: MCP_INSTRUCTIONS },
);

const mcp = async (req: Request) => withCors(await handler(req));

// MCP tool calls write to the same tables as the HTTP API, so they share a
// per-address budget instead of bypassing the limiter.
async function limited(request: Request): Promise<Response> {
  const blocked = await limit(request, "mcp", 600);
  return blocked ?? mcp(request);
}

export { mcp as GET, limited as POST, mcp as DELETE };
export const OPTIONS = preflight;
