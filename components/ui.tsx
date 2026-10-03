import Link from "next/link";
import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";

// Shared presentational pieces. No client state here, so they work in server
// and client components alike.

export function Panel({ className, ...props }: ComponentProps<"div">) {
  return <div className={clsx("panel", className)} {...props} />;
}

export function Label({ className, ...props }: ComponentProps<"span">) {
  return <span className={clsx("label", className)} {...props} />;
}

type Tone = "radar" | "distress" | "flare" | "rescue" | "mute";

const TONE: Record<Tone, string> = {
  radar: "text-bg border-ink bg-ink",
  distress: "text-distress border-distress/60 bg-distress/10",
  flare: "text-flare border-flare/60 bg-flare/10",
  rescue: "text-rescue border-rescue/60 bg-rescue/10",
  mute: "text-mute border-ink/30 bg-transparent",
};

export function Badge({ tone = "mute", className, ...props }: ComponentProps<"span"> & { tone?: Tone }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.12em]",
        TONE[tone],
        className,
      )}
      {...props}
    />
  );
}

export function Stat({
  label,
  value,
  tone = "mute",
  hint,
  className,
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
  hint?: ReactNode;
  className?: string;
}) {
  const color = { radar: "text-ink", distress: "text-distress", flare: "text-flare", rescue: "text-rescue", mute: "text-ink" }[tone];
  return (
    <div className={clsx("flex flex-col gap-2", className)}>
      <span className="label">{label}</span>
      <span className={clsx("tabular text-4xl font-semibold leading-none tracking-[-0.04em] sm:text-5xl", color)}>{value}</span>
      {hint ? <span className="text-xs text-mute">{hint}</span> : null}
    </div>
  );
}

type Variant = "primary" | "danger" | "ghost" | "flare";

const VARIANT: Record<Variant, string> = {
  primary: "bg-ink text-bg hover:bg-ink/85 border-ink",
  danger: "bg-distress text-comb hover:bg-distress/85 border-distress",
  flare: "bg-flare text-comb hover:bg-flare/85 border-flare",
  ghost: "bg-transparent text-ink hover:bg-ink hover:text-bg border-ink",
};

const BTN =
  "inline-flex items-center justify-center gap-2 rounded-full border px-5 py-2.5 text-sm font-semibold tracking-[-0.01em] transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={clsx(BTN, VARIANT[variant], className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={clsx(BTN, VARIANT[variant], className)} {...props} />;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-ink/40 px-6 py-10 text-center">
      <span className="text-sm font-semibold text-ink">{title}</span>
      {children ? <span className="max-w-md text-sm text-mute">{children}</span> : null}
    </div>
  );
}

// The Mayday bee. A single glyph, coloured by `currentColor`.
export function Bee({ className, ...props }: ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 48 40" fill="currentColor" aria-hidden="true" className={className} {...props}>
      <ellipse cx="13" cy="12" rx="11" ry="8" opacity="0.9" />
      <ellipse cx="35" cy="12" rx="11" ry="8" opacity="0.9" />
      <rect x="12" y="10" width="24" height="26" rx="12" />
      <rect x="12" y="18" width="24" height="4" fill="var(--bee-stripe, #f6cf1b)" />
      <rect x="12" y="26" width="24" height="4" fill="var(--bee-stripe, #f6cf1b)" />
      <circle cx="20" cy="14.5" r="1.8" fill="var(--bee-stripe, #f6cf1b)" />
      <circle cx="28" cy="14.5" r="1.8" fill="var(--bee-stripe, #f6cf1b)" />
    </svg>
  );
}
