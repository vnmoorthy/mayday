import { HIVEPAY_DOCS } from "@/lib/hivepay-docs";

// The outdated vendor docs the agent reads, as plain text.
export function GET(): Response {
  return new Response(HIVEPAY_DOCS, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
