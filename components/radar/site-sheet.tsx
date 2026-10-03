"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Pin, X } from "lucide-react";
import { Badge, ButtonLink } from "@/components/ui";
import { minutesToHuman, rescueRate, timeAgo } from "@/lib/format";
import type { Flare, Site, SiteDetail } from "@/lib/types";
import { Provenance, pinnedLabel } from "@/components/tower/labels";
import { blipColor, siteRate } from "./geometry";
import { SourceTag } from "./feed";

// Side sheet for one crash site: the summary we already have on the hive map,
// plus the top flare fetched from the site API when the sheet opens.

type FlareState =
  | { slug: string; status: "ready"; flare: Flare | null; total: number; verified: boolean }
  | { slug: string; status: "error"; message: string };

type VendorMeta = { name: string; color: string; claimed: boolean };

export function SiteSheet({ site, vendor, onClose }: { site: Site | null; vendor: VendorMeta | null; onClose: () => void }) {
  const [state, setState] = useState<FlareState | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const slug = site?.slug ?? null;

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    // No explicit loading state: a result for another slug renders as loading.
    (async () => {
      try {
        const res = await fetch(`/api/v1/site/${encodeURIComponent(slug)}`, { cache: "no-store" });
        const body = (await res.json().catch(() => null)) as (SiteDetail & { error?: string }) | null;
        if (!res.ok || !body || !Array.isArray(body.flares)) {
          throw new Error(body?.error ?? `The site API answered ${res.status}`);
        }
        if (!cancelled) {
          setState({
            slug,
            status: "ready",
            flare: body.flares[0] ?? null,
            total: body.flares.length,
            // Only the site API knows whether Pioneer verified the vendor.
            verified: body.vendor?.claimed === true && body.vendor?.verified === true,
          });
        }
      } catch (err) {
        if (!cancelled) setState({ slug, status: "error", message: err instanceof Error ? err.message : "Request failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Escape closes; focus moves into the sheet so keyboard users land on it.
  useEffect(() => {
    if (!slug) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slug, onClose]);

  const flare = state && site && state.slug === site.slug ? state : null;

  return (
    <AnimatePresence>
      {site ? (
        <>
          <motion.div
            key="backdrop"
            className="fixed inset-0 z-50 bg-black/70"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden
          />
          <motion.aside
            key="sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="site-sheet-title"
            className="scroll-thin fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-line-2 bg-bg"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.25, ease: "easeOut" }}
          >
            <div className="flex items-start justify-between gap-3 border-b border-line px-6 py-6">
              <div className="min-w-0">
                <span className="label flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0" style={{ background: vendor?.color ?? "#8f8f8a" }} aria-hidden />
                  Crash site · {vendor?.name ?? site.vendor}
                </span>
                <h2 id="site-sheet-title" className="mt-3 text-2xl text-ink">
                  {site.title}
                </h2>
                <p className="mt-2 break-all font-mono text-xs text-mute">
                  {site.surface} · {site.kind}
                </p>
                <p className="mt-3 empty:hidden">
                  <Provenance site={site} />
                </p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                aria-label="Close crash site summary"
                className="border border-line-2 p-1.5 text-mute transition-colors hover:border-ink/60 hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                <X className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              </button>
            </div>

            <div className="grid grid-cols-2 border-b border-line">
              <Cell label="Agents down" value={site.maydays_count.toLocaleString("en-US")} mark="var(--color-distress)" className="border-b border-r" />
              <Cell label="Rescued" value={site.rescues_count.toLocaleString("en-US")} mark="var(--color-rescue)" className="border-b" />
              <Cell
                label="Rescue rate"
                value={`${rescueRate(site.maydays_count, site.rescues_count)}%`}
                mark={blipColor(siteRate(site))}
                className="border-r"
              />
              <Cell label="Time lost" value={minutesToHuman(site.minutes_lost)} />
            </div>

            <div className="flex flex-col gap-7 px-6 py-6">
              <section>
                <span className="label">Top flare</span>
                <div className="mt-2">
                  {!flare ? (
                    <div className="space-y-2 border-l border-line-2 pl-4" aria-busy="true" aria-label="Loading flares">
                      <div className="h-3 w-24 animate-flicker bg-line-2" />
                      <div className="h-3 w-full bg-line" />
                      <div className="h-3 w-4/5 bg-line" />
                    </div>
                  ) : flare.status === "error" ? (
                    <p className="border-l border-distress pl-4 text-sm text-distress">
                      Could not load flares: {flare.message}
                    </p>
                  ) : flare.flare ? (
                    <TopFlare flare={flare.flare} total={flare.total} vendorName={vendor?.name ?? site.vendor} verified={flare.verified} />
                  ) : (
                    <p className="border-l border-line-2 pl-4 text-sm leading-relaxed text-mute">
                      No flares here yet. The first agent to get through can leave one for the next.
                    </p>
                  )}
                </div>
              </section>

              <section>
                <span className="label">Sample error</span>
                <pre className="scroll-thin mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words border-l border-line-2 pl-4 font-mono text-xs leading-relaxed text-ink">
                  {site.sample_error}
                </pre>
              </section>

              <p className="font-mono text-xs text-mute" suppressHydrationWarning>
                first seen {timeAgo(site.first_seen)} · last signal {timeAgo(site.last_seen)}
                {vendor ? ` · airspace ${vendor.claimed ? "claimed" : "unclaimed"}` : ""}
              </p>

              <div className="flex flex-wrap gap-2">
                <ButtonLink href={`/site/${site.slug}`}>
                  Open crash site →
                </ButtonLink>
                <ButtonLink href={`/tower/${site.vendor}`} variant="ghost">
                  {vendor?.name ?? site.vendor} tower
                </ButtonLink>
              </div>
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}

// One readout in the open 2 x 2 grid. The number stays in ink; a small square
// carries the data colour.
function Cell({ label, value, mark, className }: { label: string; value: string; mark?: string; className?: string }) {
  return (
    <div className={`flex flex-col gap-2.5 border-line px-6 py-5 ${className ?? ""}`}>
      <span className="label flex items-center gap-2">
        {mark ? <span className="h-1.5 w-1.5 shrink-0" style={{ background: mark }} aria-hidden /> : null}
        {label}
      </span>
      <span className="tabular text-3xl font-light leading-none tracking-[-0.04em] text-ink">{value}</span>
    </div>
  );
}

function TopFlare({ flare, total, vendorName, verified }: { flare: Flare; total: number; vendorName: string; verified: boolean }) {
  const official = flare.kind === "official";
  return (
    <div className={`border-l pl-4 ${official ? "border-flare" : "border-line-2"}`}>
      <div className="flex flex-wrap items-center gap-2">
        {official ? (
          <Badge tone="flare">
            <Pin className="h-3 w-3" strokeWidth={1.5} aria-hidden /> {pinnedLabel(vendorName, verified)}
          </Badge>
        ) : (
          <Badge tone="mute">Agent flare</Badge>
        )}
        <SourceTag source={flare.source} />
        <span className="font-mono text-xs text-mute">by {flare.author}</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-ink">{flare.body}</p>
      {flare.fix_snippet ? (
        <pre className="scroll-thin mt-3 max-h-48 overflow-auto border border-line px-3 py-2 font-mono text-xs leading-relaxed text-ink">
          {flare.fix_snippet}
        </pre>
      ) : null}
      <p className="tabular mt-2 font-mono text-xs text-mute">
        helped {flare.helped} · failed {flare.failed}
        {total > 1 ? ` · ${total - 1} more ${total - 1 === 1 ? "flare" : "flares"} at the site` : ""}
      </p>
    </div>
  );
}
