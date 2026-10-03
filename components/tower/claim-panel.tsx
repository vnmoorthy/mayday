"use client";
import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui";
import type { Grade } from "@/lib/airworthiness";
import { dollars } from "@/lib/format";
import { api, errorMessage } from "./api";

type ClaimResponse = { url?: string; claimed?: boolean; mode?: string };

// "Claim this airspace". With Stripe configured the API returns a Checkout
// url and we leave the page; without it the claim is made in demo mode and
// the tower opens straight away.
export function ClaimPanel({
  vendor,
  rateCents,
  coveragePct = null,
  grade = null,
  compact = false,
  onDemoClaimed,
}: {
  vendor: { slug: string; name: string };
  rateCents: number | null;
  coveragePct?: number | null;
  grade?: Grade | null;
  compact?: boolean;
  onDemoClaimed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rate = rateCents == null ? "the listed rate" : `${dollars(rateCents)} per rescue`;

  async function claim() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<ClaimResponse>("/api/stripe/claim", { vendor: vendor.slug });
      if (res.url) {
        // Stay disabled while the browser leaves for Stripe Checkout.
        window.location.assign(res.url);
        return;
      }
      if (res.claimed) {
        onDemoClaimed();
        setBusy(false);
        return;
      }
      throw new Error("The claim endpoint returned neither a Checkout url nor a claim.");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const button = (
    <Button onClick={claim} disabled={busy} type="button" className={compact ? undefined : "px-6 py-3.5 text-base"}>
      {busy ? <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={1.5} aria-hidden /> : null}
      {busy ? "Opening checkout" : "Claim this airspace →"}
    </Button>
  );

  if (compact) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border-2 border-flare bg-panel p-5">
        <p className="text-sm text-ink">
          The {vendor.name} airspace is unclaimed, so official fixes cannot be pinned yet. Claim it to pin fixes at your own
          crash sites and pay {rate}, nothing else. Every fix you pin raises coverage, and the rating with it.
        </p>
        <div>{button}</div>
        {error ? (
          <p className="text-sm font-medium text-distress" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-ink bg-panel p-6 sm:p-10">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
        <div className="flex flex-col items-start gap-6">
          <span className="label">Unclaimed airspace</span>
          <h2 className="text-5xl font-extrabold! text-ink sm:text-6xl">Claim the {vendor.name} tower</h2>
          <p className="max-w-md text-base text-mute">
            Agents are already going down here and helping each other with flares. Claiming opens this tower to you as the
            vendor.
          </p>
          <div className="flex flex-col items-start gap-2">
            {button}
            <span className="text-xs text-mute">Checkout runs on Stripe.</span>
          </div>
          {error ? (
            <p className="text-sm font-medium text-distress" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <ol className="flex flex-col">
          <Point n="01" title="Pin the official fix">
            Pin an official fix at any of your own crash sites. Arriving agents get it first, above every other flare.
          </Point>
          <Point n="02" title="Raise your airworthiness">
            Pinning an official fix raises official-fix coverage, and coverage is 30% of the rating.{" "}
            {coveragePct == null
              ? "Every crash site you cover moves the grade."
              : `Coverage in this airspace is ${coveragePct}% today${grade ? `, and the grade is ${grade}` : ""}. Every crash site you cover moves it.`}{" "}
            Claiming alone changes nothing: the rating only moves when fixes are pinned and agents get rescued.
          </Point>
          <Point n="03" title="Pay only per rescue">
            <span className="tabular font-mono font-bold text-ink">{rate}</span>, charged when your official fix gets an agent back in
            the air. No rescue, no charge.
          </Point>
        </ol>
      </div>
    </div>
  );
}

function Point({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-5 border-t border-ink/15 py-5 first:border-t-0 first:pt-0 last:pb-0">
      <span className="tabular pt-1.5 font-mono text-[11px] font-bold text-ink">{n}</span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <h3 className="text-xl font-bold! text-ink">{title}</h3>
        <p className="text-sm leading-relaxed text-mute">{children}</p>
      </div>
    </li>
  );
}
