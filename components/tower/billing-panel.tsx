"use client";
import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui";
import { dollars } from "@/lib/format";
import type { Billing } from "@/lib/types";
import { api, errorMessage } from "./api";
import { SectionHead } from "./parts";

export type BillingView = Billing & { stripe?: { configured: boolean; mode: string } };

export type BillingState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: BillingView };

// Loads billing for one airspace and reloads whenever `tick` changes (a rescue
// arrived) or the vendor asks. A failed reload keeps the last good numbers.
export function useBilling(slug: string, tick: number) {
  const [state, setState] = useState<BillingState>({ status: "loading" });
  const [manual, setManual] = useState(0);
  // The request that last finished. While it differs from the current one, a
  // load is in flight.
  const [settled, setSettled] = useState<string | null>(null);
  const request = `${slug}:${tick}:${manual}`;

  useEffect(() => {
    const ctrl = new AbortController();
    api<BillingView>(`/api/v1/billing/${encodeURIComponent(slug)}`, undefined, ctrl.signal)
      .then((data) => {
        setState({ status: "ready", data });
        setSettled(request);
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setState((prev) => (prev.status === "ready" ? prev : { status: "error", message: errorMessage(e) }));
        setSettled(request);
      });
    return () => ctrl.abort();
  }, [slug, request]);

  const reload = useCallback(() => setManual((n) => n + 1), []);
  return { state, refreshing: settled !== request, reload };
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-ink/15 py-3.5">
      <span className="text-sm text-mute">{label}</span>
      <span className={clsx("tabular font-mono text-sm font-bold", tone ?? "text-ink")}>{value}</span>
    </div>
  );
}

export function BillingPanel({
  index,
  state,
  refreshing,
  claimed,
  onReload,
}: {
  index: string;
  state: BillingState;
  refreshing: boolean;
  claimed: boolean;
  onReload: () => void;
}) {
  const stripe = state.status === "ready" ? state.data.stripe : undefined;
  return (
    <>
      <SectionHead
        index={index}
        title="Billing"
        rule={false}
        aside={
          <span className="flex items-center gap-3">
            {state.status === "ready" ? (
              stripe?.configured ? (
                <Badge tone="radar" title="Billable rescues are reported to Stripe as meter events">
                  Stripe {stripe.mode}
                </Badge>
              ) : (
                <Badge title="Stripe keys are not set on this deployment, so nothing is charged">Demo mode</Badge>
              )
            ) : null}
            <button
              type="button"
              onClick={onReload}
              disabled={refreshing}
              aria-label="Refresh billing"
              className="rounded-full p-1.5 text-ink transition-colors hover:bg-ink hover:text-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50"
            >
              <RefreshCw className={clsx("h-3.5 w-3.5", refreshing && "animate-spin")} strokeWidth={1.5} aria-hidden />
            </button>
          </span>
        }
      />

      {state.status === "loading" ? (
        <div className="flex flex-col" aria-busy="true" aria-label="Loading billing">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="py-2">
              <div className="h-5 animate-pulse rounded-full bg-ink/10" />
            </div>
          ))}
        </div>
      ) : state.status === "error" ? (
        <div className="flex flex-col gap-2 rounded-2xl border-2 border-distress p-4">
          <p className="text-sm font-medium text-distress" role="alert">
            Billing could not be loaded: {state.message}
          </p>
          <p className="text-xs text-mute">Use the refresh button to try again.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <span className="label">Amount due</span>
            <span className="tabular text-5xl font-extrabold leading-none tracking-tight text-ink sm:text-7xl">
              {dollars(state.data.amount_due_cents)}
            </span>
          </div>
          <div className="border-t border-ink/15">
            <Row label="Rate per rescue" value={dollars(state.data.rate_cents)} />
            <Row label="Billable rescues" value={state.data.billable_rescues.toLocaleString("en")} tone="text-rescue" />
            <Row label="Billed to Stripe" value={state.data.billed_rescues.toLocaleString("en")} />
          </div>
          <p className="max-w-xl text-sm leading-relaxed text-mute">
            {!claimed
              ? "Nothing is billable until the airspace is claimed. After that, a rescue counts only when your pinned official fix gets an agent through."
              : stripe?.configured
                ? "A rescue is billable only when your pinned official fix gets an agent through. Each one is reported to Stripe as it happens."
                : "A rescue is billable only when your pinned official fix gets an agent through. Stripe is not configured here, so rescues are counted but never charged."}
          </p>
          {state.data.stripe_customer_id ? (
            <p className="break-all font-mono text-[11px] text-mute">customer {state.data.stripe_customer_id}</p>
          ) : null}
        </>
      )}
    </>
  );
}
