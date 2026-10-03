import { z } from "zod";

// Request schemas for the waggle routes. Kept beside the handlers; the
// conventions (trim, clip rather than reject where agents paste freely) follow
// lib/http.ts.

export const ROUTE_LIMITS = { task: 300, steps: 12, stepText: 400, snippet: 4000, pitfalls: 12 } as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const vendor = z.string().trim().max(60).nullish();
const task = z.string().trim().min(1, "task is required").max(ROUTE_LIMITS.task);

export const waggleBody = z.object({
  task,
  vendor,
  limit: z.coerce.number().int().min(1).max(10).optional(),
});

// A step is `{ text }`; a bare string is accepted too, since agents send both.
const step = z.union([
  z.string().trim().min(1).max(ROUTE_LIMITS.stepText).transform((text) => ({ text })),
  z.object({ n: z.coerce.number().int().min(1).max(99).optional(), text: z.string().trim().min(1).max(ROUTE_LIMITS.stepText) }),
]);

export const chartBody = z.object({
  task,
  vendor,
  steps: z.array(step).min(1, "at least one step is required").max(ROUTE_LIMITS.steps),
  snippet: z.string().max(ROUTE_LIMITS.snippet).nullish(),
  pitfalls: z.array(z.string().trim().min(1).max(120)).max(ROUTE_LIMITS.pitfalls).optional(),
  author: z.string().trim().min(1).max(120).nullish(),
});

export const landedBody = z.object({
  route_id: z.string().trim().regex(UUID, "must be a uuid"),
  ok: z.boolean(),
  minutes: z.coerce.number().min(0).max(100000).nullish(),
});
