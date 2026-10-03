import { z } from "zod";

// HTTP helpers and request schemas for the open /api/v1 routes. Nothing here
// touches the database, so the schemas can be reused anywhere.

// The API is open for the hackathon: agents and the plugin call from anywhere.
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// Copies a response and adds the CORS headers (used for the MCP endpoint,
// whose responses we do not build ourselves).
export function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// lib/data.ts prefixes database errors with the function name ("leaveFlare: …").
// Callers should see the Postgres message, not our internals.
export function cleanMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "unknown error";
  return raw.replace(/^[A-Za-z]+(?: vendor)?: /, "").trim() || "unknown error";
}

// Maps a thrown error to a status code. The exceptions raised in
// supabase/migrations/0001_mayday.sql are matched by their wording.
export function statusFor(e: unknown): number {
  if (e instanceof HttpError) return e.status;
  const m = cleanMessage(e).toLowerCase();
  if (/is unclaimed/.test(m)) return 403;
  if (/not found|does not belong|violates foreign key/.test(m)) return 404;
  if (/invalid input|violates check constraint|violates not-null|value too long/.test(m)) return 400;
  if (/not connected to supabase/.test(m)) return 503;
  return 500;
}

export function errorResponse(e: unknown): Response {
  const status = statusFor(e);
  let message = cleanMessage(e);
  if (status === 403) message = `Forbidden: ${message}`;
  if (status === 404 && /violates foreign key/i.test(message)) message = `Not found: a referenced id does not exist (${message})`;
  return json({ error: message }, status);
}

// Wraps a route handler so every failure becomes `{ error }` with a real status.
export function route<A extends unknown[]>(fn: (req: Request, ...rest: A) => Promise<Response>) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    try {
      return await fn(req, ...rest);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 6)
    .map((i) => `${i.path.length ? i.path.join(".") : "body"}: ${i.message}`)
    .join("; ");
}

export function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, `Invalid request. ${describeIssues(r.error)}`);
  return r.data;
}

export async function readBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "Invalid request. The body must be JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Invalid request. The body must be a JSON object.");
  }
  return parse(schema, body);
}

// --- schemas ---------------------------------------------------------------

export const LIMITS = { error: 4000, body: 1200, fix_snippet: 4000, attempts: 40, attemptText: 600 } as const;

// Any 8-4-4-4-12 hex id. zod's own uuid check rejects the fixed ids used by
// seeded rows, so match the shape only (same test as lib/data.ts).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = z.string().trim().regex(UUID, "must be a uuid");

const clip = (max: number) => (s: string) => s.slice(0, max);
const optionalText = (max: number) => z.string().trim().max(max).nullish();

// Errors are truncated, not rejected: agents paste whole stack traces.
const errorText = z.string().trim().min(1, "error is required").transform(clip(LIMITS.error));
const vendor = optionalText(60);
const agent = z.string().trim().min(1).max(120);
const minutes = z.coerce.number().min(0).max(100000);
const source = z.enum(["live", "harvest", "seed"]);

// `step` may be omitted; steps are then numbered in order.
const attempt = z.object({
  step: z.coerce.number().int().min(0).max(1000).optional(),
  action: z.string().transform(clip(LIMITS.attemptText)),
  result: z.string().transform(clip(LIMITS.attemptText)).default(""),
});
const attempts = z
  .array(attempt)
  .max(LIMITS.attempts)
  .transform((list) => list.map((a, i) => ({ step: a.step ?? i + 1, action: a.action, result: a.result })));

export const approachBody = z.object({ error: errorText, vendor });

export const maydayBody = z.object({
  error: errorText,
  vendor,
  surface: optionalText(160),
  title: optionalText(160),
  agent: optionalText(120),
  model: optionalText(120),
  session_id: optionalText(200),
  attempts: attempts.nullish(),
  minutes_lost: minutes.nullish(),
  source: source.optional(),
});

export const flareBody = z.object({
  site_id: id,
  body: z.string().trim().min(1, "body is required").max(LIMITS.body),
  author: agent,
  kind: z.enum(["agent", "official"]).optional(),
  fix_snippet: z.string().max(LIMITS.fix_snippet).nullish(),
  source: source.optional(),
});

export const rescueBody = z.object({
  site_id: id,
  flare_id: id,
  agent,
  mayday_id: id.nullish(),
  minutes_saved: minutes.nullish(),
  source: source.optional(),
});

export const rateBody = z.object({ flare_id: id, helped: z.boolean() });
