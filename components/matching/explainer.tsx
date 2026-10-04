"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import type { MatchCandidate, MatchExplanation } from "@/lib/types";
import { Badge, Bee, Button } from "@/components/ui";
import { CAP, CARD, FOCUS, H2, INLINE_CODE, TCAP, TSELECT } from "@/components/cockpit/theme";
import { EXAMPLES } from "./examples";

// Paste an error, see every number Postgres computes for it. Posts to
// /api/v1/explain, which calls match_candidates(): the same four terms as
// match_site(), returned per crash site instead of collapsed into one winner.

export type VendorOption = { slug: string; name: string };

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; result: MatchExplanation; scoped: string | null }
  | { status: "error"; message: string };

const CODE_SCORE = 0.8;
const fmt = (n: number) => n.toFixed(3);

type Term = { key: "trigram" | "signature_in_error" | "error_in_signature" | "code_match"; label: string; sql: string; note: string };

const TERMS: Term[] = [
  {
    key: "trigram",
    label: "Trigram similarity",
    sql: "similarity(s.signature, p_signature)",
    note: "How many three-letter chunks the two whole strings share.",
  },
  {
    key: "signature_in_error",
    label: "Signature inside error",
    sql: "word_similarity(s.signature, p_signature)",
    note: "Is the charted signature somewhere inside the incoming error? Finds a known error buried in a long trace.",
  },
  {
    key: "error_in_signature",
    label: "Error inside signature",
    sql: "word_similarity(p_signature, s.signature)",
    note: "Is the incoming error a piece of the charted one? Finds a short excerpt. Skipped under 24 characters, where a short string would fit inside anything.",
  },
  {
    key: "code_match",
    label: "Error code match",
    sql: "position(lower(c) in lower(s.sample_error)) > 0",
    note: "A shared code of six or more characters counts as 0.8, whatever the wording around it.",
  },
];

function termValue(c: MatchCandidate, key: Term["key"]): number {
  return key === "code_match" ? (c.code_match ? CODE_SCORE : 0) : c[key];
}

// greatest() keeps one term. Which one was it?
function decidingTerm(c: MatchCandidate): Term["key"] | null {
  if (c.score <= 0) return null;
  let best: Term["key"] | null = null;
  let bestValue = 0;
  for (const t of TERMS) {
    const v = termValue(c, t.key);
    if (v > bestValue) {
      best = t.key;
      bestValue = v;
    }
  }
  return best;
}

function Bar({ value, threshold, label, strong = false }: { value: number; threshold: number; label: string; strong?: boolean }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const pass = value >= threshold;
  return (
    <div
      role="img"
      aria-label={`${label}: ${fmt(value)}, ${pass ? "at or above" : "below"} the ${threshold} threshold`}
      className={clsx("relative w-full rounded-full bg-ink/10", strong ? "h-3" : "h-2")}
    >
      <div className={clsx("h-full rounded-full", pass ? "bg-ink" : "bg-ink/40")} style={{ width: `${pct}%` }} />
      {/* The threshold: a near-black line with a pale halo, so it reads over the fill and over the empty track. */}
      <span
        aria-hidden="true"
        className="absolute -bottom-1.5 -top-1.5 w-[2px] -translate-x-1/2 bg-ink shadow-[0_0_0_1px_var(--color-comb)]"
        style={{ left: `${threshold * 100}%` }}
      />
    </div>
  );
}

function CandidateRow({
  c,
  rank,
  winner,
  threshold,
  reverseSkipped,
}: {
  c: MatchCandidate;
  rank: number;
  winner: boolean;
  threshold: number;
  reverseSkipped: boolean; // the error is under 24 characters, so the SQL skips the reverse term
}) {
  const deciding = decidingTerm(c);
  return (
    <li
      className={clsx(
        "grid gap-5 rounded-2xl border p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_10rem] lg:items-center lg:gap-8",
        winner ? "border-2 border-ink bg-comb/60" : "border-ink/15 bg-panel",
      )}
    >
      <div className="flex min-w-0 flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={clsx(CAP, "tabular text-mute")}>#{rank}</span>
          {winner ? (
            <Badge tone="radar">Matched</Badge>
          ) : c.matched ? (
            <Badge tone="mute">above threshold, outranked</Badge>
          ) : (
            <Badge tone="mute">below threshold</Badge>
          )}
        </div>
        <Link
          href={`/site/${encodeURIComponent(c.slug)}`}
          className={clsx("break-words text-lg font-bold leading-snug tracking-tight text-ink underline decoration-ink/30 underline-offset-4 hover:decoration-ink", FOCUS)}
        >
          {c.title}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-ink/30 px-2.5 py-0.5 font-mono text-[11px] text-ink">{c.vendor}</span>
          <span className="tabular text-xs text-mute">
            {c.maydays_count.toLocaleString("en-US")} {c.maydays_count === 1 ? "stop signal" : "stop signals"} on record
          </span>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        {TERMS.map((t) => {
          const v = termValue(c, t.key);
          const isCode = t.key === "code_match";
          const skipped = t.key === "error_in_signature" && reverseSkipped;
          return (
            <div key={t.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[11.5rem_minmax(0,1fr)_4.5rem]">
              <span className="order-1 flex min-w-0 flex-wrap items-center gap-x-2 text-[13px] font-medium text-ink">
                {t.label}
                {deciding === t.key ? <span className={clsx(CAP, "text-[9.5px]! text-flare")}>decides</span> : null}
              </span>
              <span className="order-2 text-right font-mono text-[12.5px] tabular text-ink sm:order-3">
                {isCode ? (c.code_match ? "yes · 0.800" : "no") : skipped ? "skipped" : fmt(v)}
              </span>
              <div className="order-3 col-span-2 sm:order-2 sm:col-span-1">
                <Bar value={v} threshold={threshold} label={t.label} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex min-w-0 flex-col gap-2 border-t border-ink/15 pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
        <span className="label">Score</span>
        <span className={clsx("tabular text-4xl font-extrabold leading-none tracking-[-0.04em]", c.matched ? "text-ink" : "text-mute")}>{fmt(c.score)}</span>
        <Bar value={c.score} threshold={threshold} label="Final score" strong />
        <span className="text-xs text-mute">
          {c.matched ? "at or past" : "short of"} {threshold}
        </span>
      </div>
    </li>
  );
}

export function MatchExplainer({
  vendors,
  initialError,
  initialVendor,
  initialResult,
  initialFailure,
}: {
  vendors: VendorOption[];
  initialError: string;
  initialVendor: string;
  initialResult: MatchExplanation | null;
  initialFailure: string | null;
}) {
  const [error, setError] = useState(initialError);
  const [vendor, setVendor] = useState(initialVendor);
  const [state, setState] = useState<State>(
    initialResult
      ? { status: "done", result: initialResult, scoped: initialVendor || null }
      : initialFailure
        ? { status: "error", message: initialFailure }
        : { status: "idle" },
  );
  const latest = useRef(0);

  async function explain(text: string, scope: string) {
    const q = text.trim();
    if (!q) return;
    const run = ++latest.current;
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/v1/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: q.slice(0, 4000), vendor: scope || null, limit: 6 }),
      });
      const data = (await res.json()) as MatchExplanation & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      if (run === latest.current) setState({ status: "done", result: data, scoped: scope || null });
    } catch (err) {
      if (run === latest.current) setState({ status: "error", message: err instanceof Error ? err.message : "Postgres did not answer." });
    }
  }

  const result = state.status === "done" ? state.result : null;
  const scoped = state.status === "done" ? state.scoped : null;
  const top = result?.candidates[0];
  const winner = top && top.matched ? top : null;
  const vendorName = (slug: string) => vendors.find((v) => v.slug === slug)?.name ?? slug;

  return (
    <div className="flex flex-col gap-12 sm:gap-16">
      <form
        className={clsx(CARD, "flex flex-col gap-5 p-4 sm:p-6")}
        onSubmit={(e) => {
          e.preventDefault();
          void explain(error, vendor);
        }}
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="match-error" className="label">
            The error an agent reports
          </label>
          <textarea
            id="match-error"
            value={error}
            onChange={(e) => setError(e.target.value)}
            maxLength={4000}
            rows={4}
            spellCheck={false}
            autoComplete="off"
            placeholder="Paste an error message or a stack trace"
            className={clsx(
              "w-full resize-y rounded-xl border border-ink/30 bg-comb/60 px-4 py-3 font-mono text-[13px] leading-relaxed text-ink placeholder:text-mute",
              FOCUS,
            )}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="label mr-1">Try</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.id}
              type="button"
              onClick={() => {
                setError(ex.error);
                setVendor("");
                void explain(ex.error, "");
              }}
              className={clsx(
                "rounded-full border px-3 py-1 text-[13px] font-medium transition-colors hover:border-ink hover:bg-ink hover:text-bg",
                error === ex.error ? "border-ink bg-ink text-bg" : "border-ink/30 text-ink",
                FOCUS,
              )}
            >
              {ex.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3 border-t border-ink/15 pt-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor="match-vendor" className="label">
              Airspace
            </label>
            <select
              id="match-vendor"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              className={clsx("w-full rounded-full border border-ink/30 bg-comb/60 px-4 py-2.5 text-sm font-medium text-ink sm:w-64", FOCUS)}
            >
              <option value="">Auto: every airspace</option>
              {vendors.map((v) => (
                <option key={v.slug} value={v.slug}>
                  {v.name} only
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={state.status === "loading" || !error.trim()} className="shrink-0">
            {state.status === "loading" ? "Asking Postgres…" : "Explain"}
          </Button>
        </div>
      </form>

      <div aria-live="polite" className="flex flex-col gap-12 sm:gap-16">
        {state.status === "error" ? (
          <p className="rounded-2xl border border-distress/50 bg-distress/10 px-5 py-4 text-sm text-distress">{state.message}</p>
        ) : null}

        {state.status === "idle" ? (
          <p className="rounded-2xl border border-dashed border-ink/40 px-5 py-6 text-sm text-mute">
            Press Explain to see the signature, the codes and the score of every nearby crash site.
          </p>
        ) : null}

        {result ? (
          <>
            {/* (a) What Postgres sees */}
            <section aria-labelledby="sees" className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <span className="label">Step 1</span>
                <h2 id="sees" className={clsx("text-3xl sm:text-4xl", H2)}>
                  What Postgres sees.
                </h2>
                <p className="max-w-2xl text-[15px] leading-relaxed text-mute">
                  Before the query, secrets are redacted and the text is normalised: lower-cased, with numbers, ids, URLs, file paths and stack
                  frames replaced, so two reports of one failure differ as little as possible.
                </p>
              </div>
              <div className="grid gap-4 lg:grid-cols-12">
                <div className={clsx("terminal min-w-0 px-4 py-4 sm:px-5 lg:col-span-7", TSELECT)}>
                  <span className={TCAP}>p_signature</span>
                  <p className="mt-2 whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-comb">{result.signature || "(empty)"}</p>
                </div>
                <div className={clsx(CARD, "flex min-w-0 flex-col gap-2.5 px-4 py-4 sm:px-5 lg:col-span-3")}>
                  <span className="label">p_codes</span>
                  {result.codes.length ? (
                    <div className="flex flex-wrap gap-2">
                      {result.codes.map((code) => (
                        <span key={code} className="break-all rounded-full border border-ink bg-ink px-2.5 py-0.5 font-mono text-[12px] text-bg">
                          {code}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-sm text-mute">No error code found in this text.</span>
                  )}
                </div>
                <div className={clsx(CARD, "flex min-w-0 flex-col gap-2.5 px-4 py-4 sm:px-5 lg:col-span-2")}>
                  <span className="label">{scoped ? "Vendor, chosen" : "Vendor guess"}</span>
                  <span className="self-start break-all rounded-full border border-ink/40 px-2.5 py-0.5 font-mono text-[12px] text-ink">{result.vendor}</span>
                  {!scoped && result.vendor === "unknown" ? <span className="text-xs text-mute">No product recognised in the text.</span> : null}
                </div>
              </div>
            </section>

            {/* (b) Ranked candidates */}
            <section aria-labelledby="ranked" className="flex flex-col gap-5">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="flex flex-col gap-2">
                  <span className="label">Step 2</span>
                  <h2 id="ranked" className={clsx("text-3xl sm:text-4xl", H2)}>
                    Every crash site gets a score.
                  </h2>
                </div>
                <span className="inline-flex items-center gap-2.5 text-sm text-ink">
                  <span aria-hidden="true" className="inline-block h-5 w-[2px] bg-ink shadow-[0_0_0_1px_var(--color-comb)]" />
                  threshold {result.threshold}: a score at or past this line is a match
                </span>
              </div>

              {winner ? (
                <div className="flex flex-col gap-1 rounded-2xl bg-ink px-5 py-4 text-bg sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                  <span className="min-w-0 break-words text-base font-semibold">
                    Matched: {winner.title}
                  </span>
                  <span className="shrink-0 font-mono text-[12.5px] tabular text-comb">
                    score {fmt(winner.score)} · threshold {result.threshold}
                  </span>
                </div>
              ) : (
                <div className="flex items-start gap-4 rounded-2xl border border-dashed border-ink/50 px-5 py-5">
                  <Bee className="mt-0.5 h-7 w-8 shrink-0 text-ink" />
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-base font-bold text-ink">Uncharted: a new crash site would be opened</span>
                    <span className="max-w-2xl text-sm leading-relaxed text-mute">
                      {top
                        ? `The best score is ${fmt(top.score)}, short of ${result.threshold}. `
                        : "There is no crash site to compare with. "}
                      {scoped
                        ? `You limited the search to ${vendorName(scoped)}. A real report would look across every airspace next, and only then open a new site; choose Auto to see that ranking.`
                        : "A real report would open a crash site for this error and count this as its first stop signal. This page is read-only, so nothing was opened."}
                    </span>
                  </div>
                </div>
              )}

              {result.candidates.length ? (
                <ol className="flex flex-col gap-3">
                  {result.candidates.map((c, i) => (
                    <CandidateRow key={c.site_id ?? c.slug} c={c} rank={i + 1} winner={winner === c} threshold={result.threshold} reverseSkipped={result.signature.length < 24} />
                  ))}
                </ol>
              ) : null}

              <p className="max-w-3xl text-sm leading-relaxed text-mute">
                The score is the greatest of the four terms, not their sum. Ties go to the site with more stop signals on record, and only the top row
                can win.{" "}
                {scoped
                  ? `These rows are limited to the ${vendorName(scoped)} airspace because you chose it.`
                  : "Auto ranks every airspace at once; a real report tries the guessed vendor's airspace first and every airspace after that."}
              </p>

              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {TERMS.map((t) => (
                  <div key={t.key} className={clsx(CARD, "flex min-w-0 flex-col gap-2 px-4 py-4")}>
                    <dt className="text-sm font-bold text-ink">{t.label}</dt>
                    <dd className="flex min-w-0 flex-col gap-2">
                      <code className={clsx(INLINE_CODE, "self-start break-all text-[11.5px]!")}>{t.sql}</code>
                      <span className="text-[13px] leading-relaxed text-mute">{t.note}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
