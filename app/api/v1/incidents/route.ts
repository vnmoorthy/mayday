import { getIncidents } from "@/lib/data";
import { json, preflight, route } from "@/lib/http";

export const dynamic = "force-dynamic";

const DEFAULT_WINDOW = 30;
const MIN_WINDOW = 5;
const MAX_WINDOW = 240;

// A missing or unreadable window falls back to the default; anything else is
// clamped to 5..240 minutes.
function windowMinutes(raw: string | null): number {
  if (raw === null || raw.trim() === "") return DEFAULT_WINDOW;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_WINDOW;
  return Math.min(MAX_WINDOW, Math.max(MIN_WINDOW, Math.round(n)));
}

// Crash sites where agents are going down faster than the site's own
// baseline, optionally for one vendor.
export const GET = route(async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const vendor = (params.get("vendor") ?? "").trim().toLowerCase().slice(0, 60) || undefined;
  const window_minutes = windowMinutes(params.get("window"));
  const incidents = await getIncidents({ vendor, windowMinutes: window_minutes });
  return json({ incidents, window_minutes });
});

export const OPTIONS = preflight;
