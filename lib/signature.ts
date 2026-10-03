// Turns a raw error into a stable signature Postgres can match with trigrams,
// and guesses which vendor's airspace the agent went down in.

const VENDOR_HINTS: { slug: string; patterns: RegExp[] }[] = [
  {
    slug: "stripe",
    patterns: [/stripe/i, /\b(pi|pm|cus|sub|evt|ch|price|prod|whsec|sk|pk|rk)_(test|live)?_?[a-z0-9]{6,}/i, /payment_?intent/i, /webhook signature/i],
  },
  {
    slug: "supabase",
    patterns: [/supabase/i, /postgrest/i, /\bPGRST\d+/i, /row-level security/i, /\bgotrue\b/i, /\brls\b/i, /realtime.*channel/i, /JWSError/i],
  },
  {
    slug: "vercel",
    patterns: [/vercel/i, /next\.?js/i, /\bnext\/(headers|server|navigation)\b/i, /edge runtime/i, /FUNCTION_INVOCATION/i, /dynamic server usage/i, /turbopack/i, /ai[- ]gateway/i, /ai sdk/i],
  },
  {
    slug: "anthropic",
    patterns: [/anthropic/i, /\bclaude\b/i, /tool_use/i, /tool_result/i, /tool_choice/i, /max_tokens/i, /overloaded_error/i, /messages\.\d+/i],
  },
];

export function detectVendor(text: string, hint?: string | null): string {
  const h = (hint ?? "").trim().toLowerCase();
  if (h) return h.replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "unknown";
  // File paths say where the project lives, not whose product failed: a repo
  // under ~/Projects/Supabase would otherwise vote for Supabase on every error.
  const body = text.replace(/(?:[A-Za-z]:)?(?:\/[\w.@~-]+){2,}/g, " ");
  let best = "unknown";
  let bestScore = 0;
  for (const v of VENDOR_HINTS) {
    const score = v.patterns.reduce((n, p) => n + (p.test(body) ? 1 : 0), 0);
    if (score > bestScore) {
      best = v.slug;
      bestScore = score;
    }
  }
  return best;
}

// Strip everything that varies between two agents hitting the same wall:
// ids, hashes, paths, line numbers, timestamps, quoted payloads.
export function normalizeError(raw: string): string {
  let s = raw.slice(0, 4000);
  s = s.replace(/\x1b\[[0-9;]*m/g, " "); // ansi colour codes
  s = s.replace(/https?:\/\/[^\s"')]+/g, (u) => {
    try {
      const url = new URL(u);
      return `${url.hostname}${url.pathname.replace(/\/[A-Za-z0-9_-]{16,}/g, "/:id")}`;
    } catch {
      return " url ";
    }
  });
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, " uuid ");
  s = s.replace(/\b(pi|pm|cus|sub|evt|ch|in|price|prod|req|acct|whsec|sk|pk|rk|seti|cs)_(test_|live_)?[A-Za-z0-9]{8,}\b/g, "$1_id");
  s = s.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, " jwt ");
  s = s.replace(/\b[0-9a-f]{16,}\b/gi, " hash ");
  s = s.replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/g, " ts ");
  s = s.replace(/(\/[\w.@-]+){2,}(\.\w+)?(:\d+){0,2}/g, " path ");
  s = s.replace(/\bat .+\(.*\)\s*$/gm, " "); // stack frames
  s = s.replace(/\bline \d+\b/gi, "line n");
  s = s.replace(/\b\d+(\.\d+)?(ms|s|kb|mb)?\b/g, " n ");
  s = s.toLowerCase();
  s = s.replace(/[^a-z0-9_:.\-/ ]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s.slice(0, 600);
}

// A short human title for a brand-new crash site.
export function titleFromError(raw: string): string {
  const line =
    raw
      .split("\n")
      .map((l) => l.trim())
      .find((l) => /error|exception|failed|denied|invalid|violat|not found|unauthorized|refused/i.test(l)) ??
    raw.split("\n")[0] ??
    "Unknown failure";
  return line.replace(/\s+/g, " ").slice(0, 110);
}

// Stable identifiers inside an error: PGRST116, FUNCTION_INVOCATION_TIMEOUT,
// overloaded_error. Postgres uses them to match a crash site even when the
// wording around the code differs between versions.
const GENERIC_CODES = new Set(["invalid_request_error", "api_error", "internal_server_error", "unknown_error"]);

export function extractCodes(raw: string): string[] {
  const text = raw.slice(0, 4000);
  const found = new Set<string>();
  const patterns = [
    /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, // FUNCTION_INVOCATION_TIMEOUT, ERR_MODULE_NOT_FOUND
    /\b[A-Z]{2,6}\d{3,5}\b/g, // PGRST116, TS2345
    /\b[a-z]+(?:_[a-z]+)*_error\b/g, // overloaded_error, rate_limit_error
  ];
  for (const p of patterns) {
    for (const m of text.match(p) ?? []) {
      if (m.length >= 6 && !GENERIC_CODES.has(m.toLowerCase())) found.add(m);
    }
  }
  return [...found].slice(0, 6);
}
