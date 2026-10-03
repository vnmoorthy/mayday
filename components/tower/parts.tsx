import clsx from "clsx";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui";
import { gradeTone, type Grade } from "@/lib/airworthiness";
import { minutesToHuman, rescueRate } from "@/lib/format";
import type { Attempt, Mayday, Source } from "@/lib/types";
import { Ago } from "./ago";

// Presentational pieces shared by the tower and the public crash-site page.
// No state here, so they render on the server and in client components.

// Page gutter, matched to the nav so every edge lines up.
export const PAGE = "mx-auto w-full max-w-[1440px] px-5 sm:px-8";

// A rounded cell on the honey field. Cards are opaque, so dense content stays
// readable while the swarm drifts behind the page.
export const CARD = "rounded-2xl border border-ink/15 bg-panel";

export const SOURCE_LABEL: Record<Source, string> = { live: "live", harvest: "test flight", seed: "charted" };

const SOURCE_HINT: Record<Source, string> = {
  live: "Reported by an agent in the wild",
  harvest: "Found by a test flight: a deliberate agent run",
  seed: "Charted from a known failure pattern, not live traffic",
};

export function SourceBadge({ source }: { source: Source }) {
  const tone = source === "live" ? "radar" : source === "harvest" ? "rescue" : "mute";
  return (
    <Badge tone={tone} title={SOURCE_HINT[source] ?? undefined}>
      {SOURCE_LABEL[source] ?? source}
    </Badge>
  );
}

// Data colours. Colour only ever means something: blue is rescue, burnt honey
// is an official fix, red is a mayday.
const TONE_TEXT = { rescue: "text-rescue", flare: "text-flare", distress: "text-distress", mute: "text-dim", ink: "text-ink" } as const;
const TONE_BG = { rescue: "bg-rescue", flare: "bg-flare", distress: "bg-distress", mute: "bg-dim", ink: "bg-ink" } as const;
export type MeterTone = keyof typeof TONE_BG;

export function gradeClass(grade: Grade): string {
  return TONE_TEXT[gradeTone(grade)];
}

// Vendor colour is identity only: a small ringed dot, never text.
export function VendorDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={clsx("inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-ink/50", className)}
      style={{ backgroundColor: color }}
    />
  );
}

// Every section opens the same way: a hairline, then "01 — Title". Inside a
// card the hairline is dropped with `rule={false}`.
export function SectionHead({
  index,
  title,
  aside,
  id,
  className,
  rule = true,
}: {
  index: string;
  title: string;
  aside?: ReactNode;
  id?: string;
  className?: string;
  rule?: boolean;
}) {
  return (
    <div
      className={clsx(
        "flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1.5",
        rule && "border-t border-ink/15 pt-4",
        className,
      )}
    >
      <h2 id={id} className="label">
        <span className="font-bold text-ink">{index}</span> — {title}
      </h2>
      {aside ? <span className="text-xs text-mute">{aside}</span> : null}
    </div>
  );
}

// A horizontal meter: a rounded track with a data-coloured fill.
export function Track({ pct, tone = "ink", label, className }: { pct: number; tone?: MeterTone; label: string; className?: string }) {
  const value = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div
      className={clsx("h-2 w-full min-w-12 overflow-hidden rounded-full bg-ink/15", className)}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-label={label}
    >
      <div className={clsx("h-full rounded-full transition-[width] duration-500", TONE_BG[tone])} style={{ width: `${value}%` }} />
    </div>
  );
}

export function RateBar({ maydays, rescues, className }: { maydays: number; rescues: number; className?: string }) {
  const pct = rescueRate(maydays, rescues);
  return (
    <div className={clsx("flex items-center gap-3", className)}>
      <Track pct={pct} tone="rescue" label="Rescue rate" />
      <span className="tabular w-10 shrink-0 text-right font-mono text-xs font-semibold text-ink">{pct}%</span>
    </div>
  );
}

// A labelled meter, used for the three components of the airworthiness score.
export function Meter({
  label,
  value,
  pct,
  tone = "ink",
  hint,
}: {
  label: string;
  value: ReactNode;
  pct: number;
  tone?: MeterTone;
  hint?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-4">
        <span className="label">{label}</span>
        <span className={clsx("tabular font-mono text-base font-bold", TONE_TEXT[tone])}>{value}</span>
      </div>
      <Track pct={pct} tone={tone} label={label} className="h-3" />
      {hint ? <span className="text-xs text-mute">{hint}</span> : null}
    </div>
  );
}

// The dark well: code, sample errors and snippets. Pale text only.
export function CodeBlock({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <pre
      className={clsx(
        "terminal max-h-72 overflow-auto whitespace-pre-wrap break-words px-5 py-4 font-mono text-xs leading-relaxed text-comb [scrollbar-color:var(--color-dim)_transparent] [scrollbar-width:thin]",
        className,
      )}
    >
      {children}
    </pre>
  );
}

export function Notice({
  tone = "radar",
  children,
  action,
}: {
  tone?: "radar" | "distress" | "flare" | "rescue";
  children: ReactNode;
  action?: ReactNode;
}) {
  const cls = {
    radar: "border-ink text-ink",
    distress: "border-distress text-distress",
    flare: "border-flare text-ink",
    rescue: "border-rescue text-ink",
  }[tone];
  return (
    <div
      role={tone === "distress" ? "alert" : "status"}
      className={clsx("flex items-start justify-between gap-4 rounded-2xl border-2 bg-panel px-5 py-4 text-sm font-medium", cls)}
    >
      <span className="min-w-0 break-words">{children}</span>
      {action}
    </div>
  );
}

// Shown when a server page cannot read the database.
export function NotConnected({ message }: { message: string }) {
  return (
    <div className={clsx(PAGE, "flex flex-col gap-6 py-16 sm:py-24")}>
      <span className="label text-distress!">Not connected</span>
      <h1 className="max-w-3xl text-5xl font-extrabold! text-ink sm:text-7xl">The tower cannot reach the database</h1>
      <p className="max-w-2xl text-base text-mute">
        Mayday reads crash sites from Supabase. Set <code className="font-mono font-semibold text-ink">NEXT_PUBLIC_SUPABASE_URL</code>,{" "}
        <code className="font-mono font-semibold text-ink">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> and{" "}
        <code className="font-mono font-semibold text-ink">SUPABASE_SERVICE_ROLE_KEY</code>, apply the migration, then reload.
      </p>
      <CodeBlock className="max-w-3xl">{message}</CodeBlock>
    </div>
  );
}

const OUTCOME: Record<Mayday["outcome"], { label: string; tone: "distress" | "rescue" | "radar" }> = {
  down: { label: "down", tone: "distress" },
  rescued: { label: "rescued", tone: "rescue" },
  self_recovered: { label: "self-recovered", tone: "radar" },
};

function cleanAttempts(raw: unknown): Attempt[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is Attempt => Boolean(a) && typeof a === "object")
    .map((a, i) => ({ step: Number(a.step) || i + 1, action: String(a.action ?? ""), result: String(a.result ?? "") }));
}

// One black-box replay: what the agent tried, step by step, before it went
// down. A numbered list joined by a hairline, the way a flight log reads.
export function Replay({ mayday }: { mayday: Mayday }) {
  const attempts = cleanAttempts(mayday.attempts);
  const outcome = OUTCOME[mayday.outcome] ?? OUTCOME.down;
  return (
    <article className={clsx(CARD, "p-5")}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="break-all font-mono text-sm font-semibold text-ink">{mayday.agent}</span>
        {mayday.model ? <span className="break-all font-mono text-xs text-mute">{mayday.model}</span> : null}
        <SourceBadge source={mayday.source} />
        <Badge tone={outcome.tone}>{outcome.label}</Badge>
        <span className="ml-auto flex items-center gap-3 font-mono text-xs text-mute">
          {Number(mayday.minutes_lost) > 0 ? <span>{minutesToHuman(Number(mayday.minutes_lost))} lost</span> : null}
          <Ago iso={mayday.created_at} />
        </span>
      </header>
      {attempts.length ? (
        <ol className="mt-4 flex flex-col">
          {attempts.map((a, i) => (
            <li key={`${a.step}-${i}`} className="relative flex gap-4 pb-4 last:pb-0">
              {i < attempts.length - 1 ? <span aria-hidden className="absolute bottom-0.5 left-[10px] top-6 w-px bg-ink/25" /> : null}
              <span className="tabular w-[21px] shrink-0 text-center font-mono text-[11px] font-semibold leading-5 text-mute">
                {String(a.step).padStart(2, "0")}
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm leading-5 text-ink">{a.action}</p>
                {a.result ? <p className="mt-1 break-words font-mono text-xs text-mute">{a.result}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 text-xs text-mute">This agent sent a mayday without a black box, so there are no steps to replay.</p>
      )}
    </article>
  );
}
