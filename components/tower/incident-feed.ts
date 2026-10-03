"use client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { Incident } from "@/lib/types";

// Incidents arrive by Realtime broadcast: a database trigger on the maydays table sends
// one message on the public channel "incidents" the moment a site spikes. One
// channel is shared by every component on the page and stays open, so a
// remount never races a channel that is still closing.

type Listener = (incident: Incident) => void;

const listeners = new Set<Listener>();
let channel: RealtimeChannel | null = null;

function toIncident(raw: unknown): Incident | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.site_id !== "string" || !p.site_id) return null;
  const now = new Date().toISOString();
  return {
    site_id: p.site_id,
    slug: typeof p.slug === "string" ? p.slug : "",
    title: typeof p.title === "string" ? p.title : "a crash site",
    vendor: typeof p.vendor === "string" ? p.vendor : "",
    surface: typeof p.surface === "string" ? p.surface : "",
    recent: Number(p.recent) || 0,
    baseline: Number(p.baseline) || 0,
    ratio: Number(p.ratio) || 0,
    first_recent: typeof p.first_recent === "string" ? p.first_recent : now,
    last_recent: typeof p.last_recent === "string" ? p.last_recent : now,
  };
}

// Calls `listener` for every incident broadcast. Returns the unsubscribe.
export function onIncident(listener: Listener): () => void {
  listeners.add(listener);
  if (!channel) {
    const supabase = supabaseBrowser();
    if (supabase) {
      channel = supabase
        .channel("incidents")
        .on("broadcast", { event: "incident" }, ({ payload }) => {
          const incident = toIncident(payload);
          if (incident) listeners.forEach((l) => l(incident));
        })
        .subscribe();
    }
  }
  return () => {
    listeners.delete(listener);
  };
}

// The newest report for a site replaces the one on screen; a new site goes first.
export function mergeIncident(list: Incident[], incident: Incident): Incident[] {
  return list.some((i) => i.site_id === incident.site_id)
    ? list.map((i) => (i.site_id === incident.site_id ? incident : i))
    : [incident, ...list];
}
