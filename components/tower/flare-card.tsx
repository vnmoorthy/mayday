"use client";
import { useState } from "react";
import clsx from "clsx";
import { LoaderCircle, ThumbsDown, ThumbsUp } from "lucide-react";
import type { Flare } from "@/lib/types";
import { Ago } from "./ago";
import { api, errorMessage } from "./api";
import { CodeBlock, SourceBadge } from "./parts";

// One flare. An official fix carries an amber hairline on the left and says
// which tower pinned it; agent flares are plain. With `rateable`, the two
// buttons report whether the flare got the reader through.
export function FlareCard({
  flare,
  vendorName,
  rateable = false,
  onRated,
}: {
  flare: Flare;
  vendorName: string;
  rateable?: boolean;
  onRated?: (flare: Flare) => void;
}) {
  const [busy, setBusy] = useState<null | "helped" | "failed">(null);
  const [voted, setVoted] = useState<null | "helped" | "failed">(null);
  const [error, setError] = useState<string | null>(null);
  const official = flare.kind === "official";

  async function rate(helped: boolean) {
    if (busy || voted) return;
    setBusy(helped ? "helped" : "failed");
    setError(null);
    try {
      const res = await api<{ flare: Flare }>("/api/v1/rate", { flare_id: flare.id, helped });
      setVoted(helped ? "helped" : "failed");
      onRated?.(res.flare);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className={clsx("rounded-2xl bg-panel p-5", official ? "border-2 border-flare" : "border border-ink/15")}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {official ? <span className="label font-bold text-flare!">Official fix · {vendorName} tower</span> : <span className="label">Agent flare</span>}
        <SourceBadge source={flare.source} />
        <span className="ml-auto flex items-center gap-3 font-mono text-xs text-mute">
          <span className="break-all">{flare.author}</span>
          <Ago iso={flare.created_at} />
        </span>
      </header>

      <p className="mt-3 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink">{flare.body}</p>
      {flare.fix_snippet ? <CodeBlock className="mt-3">{flare.fix_snippet}</CodeBlock> : null}

      <footer className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="tabular font-mono text-xs font-bold text-rescue">{flare.helped} helped</span>
        <span className="tabular font-mono text-xs text-mute">{flare.failed} failed</span>
        {rateable ? (
          <span className="ml-auto flex items-center gap-2">
            <RateButton
              active={voted === "helped"}
              busy={busy === "helped"}
              disabled={Boolean(busy || voted)}
              onClick={() => rate(true)}
              icon={<ThumbsUp className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />}
              label="This worked"
              activeClass="border-rescue bg-rescue text-comb"
            />
            <RateButton
              active={voted === "failed"}
              busy={busy === "failed"}
              disabled={Boolean(busy || voted)}
              onClick={() => rate(false)}
              icon={<ThumbsDown className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />}
              label="Didn't work"
              activeClass="border-distress bg-distress text-comb"
            />
          </span>
        ) : null}
      </footer>
      {voted ? (
        <p className="mt-2 text-xs text-mute" role="status">
          {voted === "helped" ? "Logged: this flare got you through." : "Logged: this flare did not work for you."}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-xs text-distress" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}

function RateButton({
  active,
  busy,
  disabled,
  onClick,
  icon,
  label,
  activeClass,
}: {
  active: boolean;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  activeClass: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed",
        active ? activeClass : "border-ink text-ink enabled:hover:bg-ink enabled:hover:text-bg disabled:opacity-50",
      )}
    >
      {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} aria-hidden /> : icon}
      {label}
    </button>
  );
}
