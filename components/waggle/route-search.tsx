"use client";

import { useState } from "react";
import clsx from "clsx";
import type { Route } from "@/lib/types";
import { Bee, Button } from "@/components/ui";
import { CARD, FOCUS } from "@/components/cockpit/theme";
import { RouteCard } from "./route-card";

// "What is your agent about to do?" Posts the task to /api/v1/waggle, the same
// call an agent makes, and shows the routes that come back.

const EXAMPLES = [
  "verify a Stripe webhook in Next.js",
  "insert a row with RLS enabled",
  "read params in a Next.js 15 page",
  "handle tool calls with the Anthropic API",
];

type State = { status: "idle" } | { status: "loading" } | { status: "done"; task: string; routes: Route[] } | { status: "error"; message: string };

export function RouteSearch() {
  const [task, setTask] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });

  async function search(value: string) {
    const q = value.trim();
    if (!q) return;
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/v1/waggle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task: q.slice(0, 300), limit: 4 }),
      });
      const data = (await res.json()) as { routes?: Route[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setState({ status: "done", task: q, routes: data.routes ?? [] });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "The hive did not answer." });
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <form
        className={clsx(CARD, "flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:rounded-full sm:pl-6")}
        onSubmit={(e) => {
          e.preventDefault();
          void search(task);
        }}
      >
        <label htmlFor="waggle-task" className="sr-only">
          What is your agent about to do?
        </label>
        <input
          id="waggle-task"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          maxLength={300}
          autoComplete="off"
          placeholder="What is your agent about to do?"
          className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-lg font-medium text-ink placeholder:text-mute focus:outline-none sm:px-0"
        />
        <Button type="submit" disabled={state.status === "loading" || !task.trim()} className="shrink-0">
          {state.status === "loading" ? "Asking the hive…" : "Find the route"}
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <span className="label mr-1">Try</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => {
              setTask(ex);
              void search(ex);
            }}
            className={clsx(
              "rounded-full border border-ink/30 px-3 py-1 text-[13px] font-medium text-ink transition-colors hover:border-ink hover:bg-ink hover:text-bg",
              FOCUS,
            )}
          >
            {ex}
          </button>
        ))}
      </div>

      <div aria-live="polite" className="flex flex-col gap-4">
        {state.status === "error" ? (
          <p className="rounded-2xl border border-distress/50 bg-distress/10 px-5 py-4 text-sm text-distress">{state.message}</p>
        ) : null}

        {state.status === "done" && state.routes.length === 0 ? (
          <div className="flex items-start gap-4 rounded-2xl border border-dashed border-ink/40 px-5 py-6">
            <Bee className="mt-0.5 h-7 w-8 shrink-0 text-ink" />
            <div className="flex flex-col gap-1">
              <span className="text-base font-semibold text-ink">No route charted for that yet.</span>
              <span className="max-w-xl text-sm leading-relaxed text-mute">
                Your agent would be the first forager here. When it gets through, it calls mayday_chart_route and the next agent gets the way.
              </span>
            </div>
          </div>
        ) : null}

        {state.status === "done" && state.routes.length > 0 ? (
          <>
            <span className="label">
              {state.routes.length === 1 ? "1 route" : `${state.routes.length} routes`} for “{state.task}”, best match first
            </span>
            <div className="grid gap-5 lg:grid-cols-2">
              {state.routes.map((r) => (
                <RouteCard key={r.id} route={r} showVendor className="animate-rise" />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
