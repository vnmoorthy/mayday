"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { Button, Empty } from "@/components/ui";
import { minutesToHuman } from "@/lib/format";
import type { Flare, Site, SiteDetail, Vendor } from "@/lib/types";
import { api, errorMessage } from "./api";
import { ClaimPanel } from "./claim-panel";
import { FlareCard } from "./flare-card";
import { Provenance } from "./labels";
import { FlareForm } from "./flare-form";
import { CodeBlock, RateBar, Replay, SectionHead } from "./parts";

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; detail: SiteDetail };

const REPLAYS = 6;

// Detail drawer for one crash site in the tower. `site` is the live table row,
// so the counters at the top keep moving; the rest comes from the site API and
// reloads when `tick` changes (something new landed at this site).
export function SiteDrawer({
  site,
  vendor,
  tick,
  rateCents,
  onClose,
  onOfficialPinned,
  onDemoClaimed,
}: {
  site: Site;
  vendor: Vendor;
  tick: number;
  rateCents: number | null;
  onClose: () => void;
  onOfficialPinned: (siteId: string) => void;
  onDemoClaimed: () => void;
}) {
  const reduce = useReducedMotion();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<State>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    api<SiteDetail>(`/api/v1/site/${encodeURIComponent(site.slug)}`, undefined, ctrl.signal)
      .then((detail) => setState({ status: "ready", detail }))
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        // A failed background reload keeps what is already on screen.
        setState((prev) => (prev.status === "ready" ? prev : { status: "error", message: errorMessage(e) }));
      });
    return () => ctrl.abort();
  }, [site.slug, tick, retry]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // The page behind the drawer should not scroll while it is open.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  function pinned(flare: Flare) {
    setForbidden(false);
    setState((prev) =>
      prev.status === "ready"
        ? { status: "ready", detail: { ...prev.detail, flares: [flare, ...prev.detail.flares.filter((f) => f.id !== flare.id)] } }
        : prev,
    );
    onOfficialPinned(site.id);
  }

  const detail = state.status === "ready" ? state.detail : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`Crash site: ${site.title}`}>
      <motion.button
        type="button"
        aria-label="Close crash site detail"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink/60"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduce ? 0 : 0.2 }}
      />
      <motion.aside
        className="scroll-thin relative flex h-full w-full max-w-2xl flex-col overflow-y-auto border-l-2 border-ink bg-bg sm:rounded-l-3xl"
        initial={{ x: reduce ? 0 : 48, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: reduce ? 0 : 48, opacity: 0 }}
        transition={{ duration: reduce ? 0 : 0.22, ease: "easeOut" }}
      >
        <header className="sticky top-0 z-10 flex items-start gap-4 border-b border-ink/15 bg-bg px-5 py-5 sm:px-8">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <span className="label">
              Crash site · {site.kind} · {vendor.name}
            </span>
            <h2 className="break-words text-3xl font-extrabold! text-ink sm:text-4xl">{site.title}</h2>
            <span className="break-all font-mono text-xs text-mute">{site.surface}</span>
            <span>
              <Provenance site={site} />
            </span>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full border border-ink p-2 text-ink transition-colors hover:bg-ink hover:text-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          </button>
        </header>

        <div className="flex flex-col gap-10 px-5 py-8 sm:px-8">
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-ink/15 bg-ink/15">
              <Mini label="Agents down" value={site.maydays_count.toLocaleString("en")} tone="text-distress" />
              <Mini label="Rescued" value={site.rescues_count.toLocaleString("en")} tone="text-rescue" />
              <Mini label="Hours lost" value={minutesToHuman(site.minutes_lost)} tone="text-ink" />
            </div>
            <RateBar maydays={site.maydays_count} rescues={site.rescues_count} />
          </div>

          <section className="flex flex-col gap-4">
            <SectionHead index="01" title="Sample error" />
            <CodeBlock>{site.sample_error}</CodeBlock>
          </section>

          {state.status === "loading" ? (
            <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading crash site">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-2xl bg-ink/10" />
              ))}
            </div>
          ) : null}

          {state.status === "error" ? (
            <div className="flex flex-col items-start gap-3 rounded-2xl border-2 border-distress bg-panel p-4">
              <p className="text-sm font-medium text-distress" role="alert">
                Could not load this crash site: {state.message}
              </p>
              <Button
                variant="ghost"
                type="button"
                onClick={() => {
                  setState({ status: "loading" });
                  setRetry((n) => n + 1);
                }}
              >
                Try again
              </Button>
            </div>
          ) : null}

          {detail ? (
            <>
              <section className="flex flex-col gap-5">
                <SectionHead index="02" title="Flares" aside={<span className="tabular font-mono">{detail.flares.length}</span>} />
                {detail.flares.length ? (
                  <div className="flex flex-col gap-4">
                    {detail.flares.map((f) => (
                      <FlareCard key={f.id} flare={f} vendorName={vendor.name} verified={vendor.verified === true} />
                    ))}
                  </div>
                ) : (
                  <Empty title="No flares at this crash site">
                    Agents are going down here with nothing to guide them. An official fix would be the first thing they see.
                  </Empty>
                )}
              </section>

              <section className="flex flex-col gap-5">
                <SectionHead index="03" title="Pin official fix" />
                <p className="text-sm text-mute">
                  Pinned above every other flare and handed first to each agent that arrives at this crash site. It also
                  counts this site toward official-fix coverage, which raises the airworthiness rating.
                  {vendor.claimed ? "" : " Pinning needs a claimed airspace."}
                </p>
                <FlareForm
                  siteId={site.id}
                  kind="official"
                  defaultAuthor={vendor.slug}
                  draftSite={site.slug}
                  submitLabel="Pin official fix"
                  bodyPlaceholder={`What should an agent do when it hits this on ${vendor.name}?`}
                  onCreated={pinned}
                  onForbidden={() => setForbidden(true)}
                />
                {forbidden && !vendor.claimed ? (
                  <ClaimPanel vendor={vendor} rateCents={rateCents} compact onDemoClaimed={onDemoClaimed} />
                ) : null}
              </section>

              <section className="flex flex-col gap-5">
                <SectionHead
                  index="04"
                  title="Black-box replays"
                  aside={
                    <span className="tabular font-mono">
                      last {Math.min(REPLAYS, detail.maydays.length)} of {site.maydays_count.toLocaleString("en")}
                    </span>
                  }
                />
                {detail.maydays.length ? (
                  <div className="flex flex-col gap-4">
                    {detail.maydays.slice(0, REPLAYS).map((m) => (
                      <Replay key={m.id} mayday={m} />
                    ))}
                  </div>
                ) : (
                  <Empty title="No stop signals recorded here yet" />
                )}
              </section>
            </>
          ) : null}

          <Link
            href={`/site/${site.slug}`}
            className="self-start text-sm font-semibold text-ink underline underline-offset-4 hover:no-underline"
          >
            Open the public crash-site page →
          </Link>
        </div>
      </motion.aside>
    </div>
  );
}

function Mini({ label, value, tone, className }: { label: string; value: string; tone: string; className?: string }) {
  return (
    <div className={`flex min-w-0 flex-col gap-2 bg-panel p-4 sm:p-5 ${className ?? ""}`}>
      <span className="label">{label}</span>
      <span className={`tabular text-3xl font-extrabold leading-none tracking-tight ${tone}`}>{value}</span>
    </div>
  );
}
