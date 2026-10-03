import "server-only";
import { generateText } from "ai";

// Model access for drafting text. Two routes, tried in order:
//   1. Gemini's REST API, when GEMINI_API_KEY is set.
//   2. The Vercel AI Gateway through the "ai" package (AI_GATEWAY_API_KEY, or
//      the OIDC token Vercel injects into deployments and `vercel env pull`).
// Callers only use draftText and modelAccessConfigured.

export type DraftProvider = "gemini" | "gateway";
export type Draft = { text: string; model: string; provider: DraftProvider };

const NO_ACCESS = "No model access: set GEMINI_API_KEY, or enable Vercel AI Gateway for this team.";
const GEMINI_TIMEOUT_MS = 20_000;
const GATEWAY_TIMEOUT_MS = 25_000;

export function modelAccessConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY || process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
}

// Upstream error text can echo request details. Remove anything that is, or
// looks like, a credential before it reaches a response body.
function scrub(message: string): string {
  let out = message;
  for (const name of ["GEMINI_API_KEY", "AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"]) {
    const value = process.env[name];
    if (value && value.length >= 8) out = out.split(value).join("[redacted]");
  }
  return out
    .replace(/([?&]key=)[^&\s"']+/gi, "$1[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/g, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function reason(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === "TimeoutError" || e.name === "AbortError") return "the request timed out";
    return scrub(e.message) || "unknown error";
  }
  return typeof e === "string" ? scrub(e) || "unknown error" : "unknown error";
}

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
};

async function draftWithGemini(prompt: string, system: string, key: string): Promise<Draft> {
  const model = (process.env.GEMINI_MODEL || "gemini-2.5-flash").trim().replace(/^models\//, "");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      cache: "no-store",
    },
  );

  let data: GeminiResponse | null = null;
  try {
    data = (await res.json()) as GeminiResponse;
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new Error(data?.error?.message || `Gemini responded ${res.status}`);
  }

  const text = (data?.candidates?.[0]?.content?.parts ?? [])
    .map((p) => (typeof p?.text === "string" ? p.text : ""))
    .join("")
    .trim();
  if (!text) {
    const why = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason;
    throw new Error(why ? `Gemini returned no text (${why})` : "Gemini returned no text");
  }
  return { text, model, provider: "gemini" };
}

async function draftWithGateway(prompt: string, system: string): Promise<Draft> {
  const model = (process.env.AI_GATEWAY_MODEL || "anthropic/claude-haiku-4.5").trim();
  // One attempt, hard-bounded: the abort signal stops the model call, and the
  // race also covers credential lookup, which the signal does not reach.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const e = new Error("the request timed out");
      e.name = "TimeoutError";
      reject(e);
    }, GATEWAY_TIMEOUT_MS + 2_000);
  });
  const call = generateText({
    model,
    system,
    prompt,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
  });
  call.catch(() => {}); // a late rejection after the deadline must not go unhandled
  let result: Awaited<typeof call>;
  try {
    result = await Promise.race([call, deadline]);
  } finally {
    clearTimeout(timer);
  }
  const text = (result.text ?? "").trim();
  if (!text) throw new Error("the gateway returned no text");
  return { text, model, provider: "gateway" };
}

// Drafts text with whichever model route is available. Throws an Error with a
// plain, key-free message when neither route works.
export async function draftText(prompt: string, system: string): Promise<Draft> {
  const failures: string[] = [];

  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (geminiKey) {
    try {
      return await draftWithGemini(prompt, system, geminiKey);
    } catch (e) {
      failures.push(`Gemini: ${reason(e)}`);
    }
  }

  try {
    return await draftWithGateway(prompt, system);
  } catch (e) {
    failures.push(`AI Gateway: ${reason(e)}`);
  }

  throw new Error(`${NO_ACCESS} (${failures.join("; ")})`);
}
