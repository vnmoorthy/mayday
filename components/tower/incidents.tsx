"use client";
import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Bee, Button } from "@/components/ui";
import type { Incident } from "@/lib/types";
import { Ago } from "./ago";
import { api } from "./api";
import { SectionHead } from "./parts";

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; incidents: Incident[]; window: number };

const POLL_MS = 30_000;
const DEFAULT_WINDOW = 30;

function ratioText(raw: number): string {
  const r = Number(raw);
  if (!Number.isFinite(r) || r <= 0) return "above its baseline";
  return `${r >= 10 ? Math.round(r) : r.toFixed(1)}x its baseline`;
}

// Spikes in one airspace: crash sites where agents are going down faster than
// the site's own baseline. Reloads when `tick` changes (a mayday arrived for
// this vendor) and every 30 seconds.
export function Incidents({
  index,
  slug,
  tick,
  onOpen,
}: {
  index: string;
  slug: string;
  tick: number;
  onOpen: (incident: Incident) => void;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [poll, setPoll] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setPoll((n) => n + 1), POLL_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    api<{ incidents?: Incident[]; window_minutes?: number }>(
      `/api/v1/incidents?vendor=${encodeURIComponent(slug)}`,
      undefined,
      ctrl.signal,
    )
      .then((d) =>
        setState({
          status: "ready",
          incidents: Array.isArray(d?.incidents) ? d.incidents : [],
          window: Number(d?.window_minutes) || DEFAULT_WINDOW,
        }),
      )
      .catch(() => {
        if (ctrl.signal.aborted) return;
        setState({ status: "error" });
      });
    return () => ctrl.abort();
  }, [slug, tick, poll]);

  const incidents = state.status === "ready" ? state.incidents : [];
  const windowMin = state.status === "ready" ? state.window : DEFAULT_WINDOW;

  return (
    <section className="flex flex-col gap-5" aria-labelledby="incidents-heading">
      <SectionHead
        index={index}
        title="Incidents"
        id="incidents-heading"
        aside={
          incidents.length ? (
            <span className="inline-flex items-center gap-2 font-mono font-bold text-distress">
              <span className="h-2 w-2 rounded-full bg-distress animate-flicker" aria-hidden />
              {incidents.length} active {incidents.length === 1 ? "spike" : "spikes"}
            </span>
          ) : (
            `Checked every 30 seconds, and whenever a mayday lands`
          )
        }
      />

      {incidents.length ? (
        <ul className="grid gap-4 lg:grid-cols-2">
          {incidents.map((i) => (
            <li
              key={i.site_id}
              className="flex flex-col gap-4 rounded-2xl border-2 border-distress bg-panel p-5 sm:p-6"
            >
              <span className="label inline-flex items-center gap-2 font-bold text-distress!">
                <TriangleAlert className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                Spike
              </span>
              <p className="text-2xl font-extrabold leading-tight tracking-tight text-ink sm:text-3xl">
                Spike: <span className="tabular text-distress">{Number(i.recent).toLocaleString("en")}</span>{" "}
                {Number(i.recent) === 1 ? "agent" : "agents"} down in the last {windowMin} min at{" "}
                <span className="break-words">{i.title}</span>
              </p>
              <span className="break-all font-mono text-xs text-mute">{i.surface}</span>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-xs text-mute">
                <span className="rounded-full bg-distress px-3 py-1 font-bold text-comb">{ratioText(i.ratio)}</span>
                <span>
                  first <Ago iso={i.first_recent} />
                </span>
                <span>
                  last <Ago iso={i.last_recent} />
                </span>
              </div>
              <div>
                <Button type="button" variant="danger" onClick={() => onOpen(i)}>
                  Open crash site →
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-3 text-sm text-mute" role="status">
          <Bee className="h-5 w-6 shrink-0 text-ink" />
          {state.status === "loading" ? (
            <span>Checking every crash site against its own baseline.</span>
          ) : state.status === "error" ? (
            <span>
              <span className="font-semibold text-ink">Incident detection unavailable.</span> The crash sites below still update
              live.
            </span>
          ) : (
            <span>
              <span className="font-semibold text-ink">No spikes in the last {windowMin} minutes.</span> Mayday watches every
              crash site against its own baseline.
            </span>
          )}
        </p>
      )}
    </section>
  );
}
