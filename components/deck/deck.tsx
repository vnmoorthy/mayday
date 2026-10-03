"use client";

import { MotionConfig, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { Hex } from "./comb";
import { notes, SLIDE_TITLES } from "./notes";
import { SLIDES, type MapState } from "./slides";

// The presentation shell: a fixed 1920x1080 stage scaled to fit the viewport
// (letterboxed on the honey field), keyboard and click navigation, the slide index in
// the URL hash, a progress hairline and a speaker-notes drawer.

const W = 1920;
const H = 1080;
const COUNT = SLIDES.length;

function fromHash(): number | null {
  const n = parseInt(window.location.hash.replace("#", ""), 10);
  return Number.isFinite(n) && n >= 1 && n <= COUNT ? n - 1 : null;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

type MapPayload = {
  vendors?: { name?: string; slug?: string; sites?: number; maydays?: number; rescues?: number }[];
  sites?: { title?: string; vendor?: string; maydays_count?: number; minutes_lost?: number }[];
};

export function Deck() {
  const reduced = useReducedMotion() ?? false;
  const [ready, setReady] = useState(false);
  const [index, setIndex] = useState(0);
  const [scale, setScale] = useState(1);
  const [notesOpen, setNotesOpen] = useState(false);
  const [map, setMap] = useState<MapState>({ status: "loading" });

  const go = useCallback((to: number) => setIndex(Math.max(0, Math.min(COUNT - 1, to))), []);
  const next = useCallback(() => setIndex((i) => Math.min(COUNT - 1, i + 1)), []);
  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // Fit the stage, and pick the slide up from the hash so a reload stays put.
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / W, window.innerHeight / H));
    const onHash = () => {
      const n = fromHash();
      if (n !== null) setIndex(n);
    };
    fit();
    onHash();
    setReady(true);
    window.addEventListener("resize", fit);
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const hash = `#${index + 1}`;
    if (window.location.hash !== hash) window.history.replaceState(null, "", hash);
  }, [index, ready]);

  // The live numbers for slides 5 and 6. Loaded up front so they are there
  // when the presenter arrives, and refreshed on entering slide 5.
  const loadMap = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/map", { cache: "no-store" });
      if (!res.ok) throw new Error(`map ${res.status}`);
      const data = (await res.json()) as MapPayload;
      const vendors = Array.isArray(data.vendors) ? data.vendors : [];
      if (vendors.length === 0) throw new Error("map empty");
      const names = new Map(vendors.map((v) => [v.slug ?? "", v.name ?? v.slug ?? ""]));
      const sum = (k: "sites" | "maydays" | "rescues") => vendors.reduce((a, v) => a + (Number(v[k]) || 0), 0);
      const top = (Array.isArray(data.sites) ? data.sites : [])
        .slice()
        .sort((a, b) => (b.maydays_count ?? 0) - (a.maydays_count ?? 0))
        .slice(0, 5)
        .map((s) => ({
          title: s.title ?? "",
          vendor: names.get(s.vendor ?? "") || (s.vendor ?? ""),
          maydays: s.maydays_count ?? 0,
          hours: Math.round((s.minutes_lost ?? 0) / 60),
        }));
      setMap({
        status: "ok",
        maydays: sum("maydays"),
        rescues: sum("rescues"),
        sites: sum("sites"),
        vendors: vendors.length,
        top,
      });
    } catch {
      // Keep the last good numbers if a refresh fails.
      setMap((m) => (m.status === "ok" ? m : { status: "error" }));
    }
  }, []);

  useEffect(() => {
    void loadMap();
  }, [loadMap]);
  useEffect(() => {
    if (ready && index === 4) void loadMap();
  }, [index, ready, loadMap]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === "ArrowRight" || k === " " || k === "PageDown") {
        e.preventDefault();
        next();
      } else if (k === "ArrowLeft" || k === "PageUp") {
        e.preventDefault();
        prev();
      } else if (k === "Home") {
        e.preventDefault();
        go(0);
      } else if (k === "End") {
        e.preventDefault();
        go(COUNT - 1);
      } else if (k >= "1" && k <= "9" && k.length === 1) {
        go(Number(k) - 1);
      } else if (k === "0") {
        go(9);
      } else if (k === "f" || k === "F") {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
        else void document.documentElement.requestFullscreen?.().catch(() => {});
      } else if (k === "n" || k === "N") {
        setNotesOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, next, prev]);

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-no-nav]")) return;
    if (e.clientX < window.innerWidth / 2) prev();
    else next();
  };

  const Slide = SLIDES[index];

  return (
    <MotionConfig reducedMotion="user">
      <div
        className="absolute inset-0 cursor-default select-none overflow-hidden bg-[#f6cf1b]"
        onClick={onClick}
        role="region"
        aria-roledescription="slide deck"
        aria-label={`Mayday presentation, slide ${index + 1} of ${COUNT}: ${SLIDE_TITLES[index]}`}
      >
        {ready ? (
          <div
            className="absolute left-1/2 top-1/2 overflow-hidden bg-[#f6cf1b]"
            style={{
              width: W,
              height: H,
              marginLeft: -W / 2,
              marginTop: -H / 2,
              transform: `scale(${scale})`,
              transformOrigin: "center center",
            }}
          >
            <motion.div
              key={index}
              className="absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              <Slide reduced={reduced} map={map} />
            </motion.div>

            {/* Footer: wordmark, key hints, counter, and the progress hairline. */}
            <div className="pointer-events-none absolute inset-x-[110px] bottom-[44px] flex items-center justify-between font-mono text-[19px] font-semibold uppercase tracking-[0.2em] text-[#54491a]">
              <span className="flex items-center gap-[12px]">
                <Hex size={18} />
                <span className="text-[#17130d]">Mayday</span>
                <span className="ml-[20px] text-[15px] tracking-[0.16em]">Arrows move · N notes · F fullscreen</span>
              </span>
              <span className="tabular-nums text-[#54491a]">
                <span className="text-[#17130d]">{pad(index + 1)}</span> / {pad(COUNT)}
              </span>
            </div>
            <div className="absolute inset-x-0 bottom-0 h-[6px] bg-[#17130d]/15">
              <motion.div
                className="h-full bg-[#17130d]"
                initial={false}
                animate={{ width: `${((index + 1) / COUNT) * 100}%` }}
                transition={{ duration: reduced ? 0 : 0.4, ease: "easeOut" }}
              />
            </div>
          </div>
        ) : null}

        {notesOpen ? (
          <aside
            data-no-nav
            className="absolute inset-x-0 bottom-0 z-10 cursor-auto select-text border-t-2 border-[#17130d] bg-[#f9db4a] px-[4vw] py-[2.4vh] text-[#17130d]"
            aria-label="Speaker notes"
          >
            <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.18em] text-[#54491a]">
              <span>
                <span className="font-bold text-[#17130d]">Speaker notes</span> · {pad(index + 1)} / {pad(COUNT)} · {SLIDE_TITLES[index]}
              </span>
              <button
                type="button"
                className="rounded-full border border-[#17130d] px-3 py-1 text-[#17130d] hover:bg-[#17130d] hover:text-[#f6cf1b]"
                onClick={() => setNotesOpen(false)}
              >
                Close · N
              </button>
            </div>
            <p className="mt-3 max-w-[1100px] text-[clamp(16px,1.5vw,24px)] leading-[1.45] text-[#17130d]">{notes[index]}</p>
          </aside>
        ) : null}
      </div>
    </MotionConfig>
  );
}
