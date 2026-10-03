"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Comb, DECK_COLORS, Hex, hexDist, type CellState } from "./comb";

// The ten slides. Each one is drawn on a fixed 1920x1080 stage (the shell
// scales it), so every size here is in stage pixels. A slide is mounted only
// while it is active: its motion starts on entry and resets when it is left.
// The look: a honey-yellow field, near-black extrabold type, pill labels, and
// a dark terminal well for code lines only.

export const LIVE_URL = "https://mayday-alpha-eight.vercel.app";
export const REPO_URL = "https://github.com/vnmoorthy/mayday";

export type MapState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ok";
      maydays: number;
      rescues: number;
      sites: number;
      vendors: number;
      top: { title: string; vendor: string; maydays: number; hours: number }[];
    };

export type SlideProps = { reduced: boolean; map: MapState };

const { red: RED, honey: HONEY, wax: WAX, ink: INK, dim: DIM, line: LINE, mute: MUTE, panel: PANEL } = DECK_COLORS;
const EASE: [number, number, number, number] = [0.2, 0.7, 0.2, 1];

const PILL =
  "inline-flex items-center gap-[14px] rounded-full border-[2px] border-[#17130d] px-[24px] py-[9px] font-mono text-[20px] uppercase tracking-[0.2em] text-[#17130d]";
const PILL_DARK =
  "inline-flex items-center gap-[14px] rounded-full bg-[#17130d] px-[26px] py-[11px] font-mono text-[20px] uppercase tracking-[0.2em] text-[#fff6c2]";

// ---------------------------------------------------------------- helpers

// Counts 0..total on a timer. loopHold > 0 restarts after holding the last
// step. With reduced motion it sits on the final step.
function useSteps(total: number, interval: number, startDelay: number, loopHold: number, reduced: boolean) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (reduced) return;
    let s = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      s = s >= total ? 0 : s + 1;
      setStep(s);
      if (s >= total) {
        if (loopHold > 0) timer = setTimeout(tick, loopHold);
      } else {
        timer = setTimeout(tick, s === 0 ? startDelay : interval);
      }
    };
    timer = setTimeout(tick, startDelay);
    return () => clearTimeout(timer);
  }, [total, interval, startDelay, loopHold, reduced]);
  return reduced ? total : step;
}

// Ticks a number from where it is to the target.
function useCountUp(target: number, duration: number, reduced: boolean) {
  const [value, setValue] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (reduced) return;
    const start = from.current;
    const t0 = performance.now();
    let raf = 0;
    const frame = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const v = Math.round(start + (target - start) * (1 - Math.pow(1 - p, 3)));
      from.current = v;
      setValue(v);
      if (p < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, reduced]);
  return reduced ? target : value;
}

function Rise({
  delay = 0,
  y = 26,
  className,
  style,
  children,
}: {
  delay?: number;
  y?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

function Frame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col px-[110px] pb-[120px] pt-[72px]">
      <Rise y={10} className="flex">
        <span className={PILL}>
          <Hex size={20} />
          {label}
        </span>
      </Rise>
      <div className="relative mt-[32px] min-h-0 flex-1">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- 1 title

const HERO_MASK = "linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.5) 18%, #000 38%)";
const PILLARS = ["Stop signal", "Waggle dance", "Vaccination"];

function TitleSlide({ reduced }: SlideProps) {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <motion.img
        src="/art/hero-1600.jpg"
        alt="Macro photograph of honeybees on a slab of golden honeycomb; two cells glow red."
        width={1600}
        height={893}
        loading="eager"
        decoding="async"
        className="absolute inset-y-0 right-0 h-full w-[1260px] max-w-none object-cover object-right"
        style={{ maskImage: HERO_MASK, WebkitMaskImage: HERO_MASK }}
        initial={{ opacity: 0, scale: reduced ? 1 : 1.05 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.4, ease: EASE }}
      />
      <div className="absolute inset-y-0 left-[110px] flex flex-col justify-center pb-[40px]">
        <Rise y={10} className="flex">
          <span className={PILL}>
            <Hex size={20} />
            Supabase Select 2026 hackathon
          </span>
        </Rise>
        <Rise delay={0.12}>
          <div role="heading" aria-level={1} className="dk-display mt-[30px] text-[272px] leading-[0.88] tracking-[-0.06em]">
            Mayday
          </div>
        </Rise>
        <Rise delay={0.28}>
          <p className="dk-display mt-[34px] text-[66px]">The stop signal for agents.</p>
        </Rise>
        <Rise delay={0.44} className="mt-[40px] flex gap-[14px]">
          {PILLARS.map((p) => (
            <span key={p} className={PILL_DARK}>
              {p}
            </span>
          ))}
        </Rise>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- 2 honeybee

function HoneybeeSlide({ reduced }: SlideProps) {
  return (
    <Frame label="The honeybee">
      <div className="flex h-full items-center justify-between gap-[64px]">
        <div className="w-[720px] shrink-0">
          <Rise delay={0.1}>
            <div role="heading" aria-level={2} className="dk-display text-[92px]">
              A honeybee attacked at a flower warns the hive off that path.
            </div>
          </Rise>
          <Rise delay={0.45}>
            <p className="dk-display mt-[44px] text-[62px] text-[#7a3f00]">One bee pays. The hive doesn&rsquo;t.</p>
          </Rise>
        </div>
        <motion.div
          className="relative min-w-0 flex-1"
          initial={{ opacity: 0, scale: reduced ? 1 : 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.2, ease: EASE }}
        >
          <img
            src="/art/stop.jpg"
            alt="Macro photograph of a honeybee giving another bee the stop signal, ringed by worker bees."
            width={1376}
            height={768}
            loading="eager"
            decoding="async"
            className="aspect-[1376/768] w-full rounded-[44px] border-[3px] border-[#17130d] object-cover shadow-[0_30px_80px_-30px_rgba(23,19,13,0.55)]"
          />
          <Rise delay={0.9} y={12} className="absolute bottom-[26px] left-[26px] flex items-center gap-[14px]">
            <span className={PILL_DARK}>
              <span className="relative inline-flex h-[14px] w-[14px]">
                <span className="absolute inset-0 dk-blip rounded-full bg-[#b80f26]" />
                <span className="relative h-[14px] w-[14px] rounded-full bg-[#b80f26]" />
              </span>
              The stop signal
            </span>
          </Rise>
        </motion.div>
      </div>
    </Frame>
  );
}

// -------------------------------------------------------------- 3 problem

const WALLS = [
  { error: "No signatures found matching the expected signature for payload", where: "Stripe webhooks" },
  { error: "new row violates row-level security policy", where: "Supabase" },
  { error: "params should be awaited before using its properties", where: "Next.js" },
];
const SWARM = 12;
const CRASH = { x: 285.5, y: 310 };
const BEE = 58;
const STARTS = Array.from({ length: SWARM }, (_, i) => {
  const deg = ((i * 67) % 200) - 100;
  const a = (Math.PI / 180) * deg;
  // The photographed bee points up; turn her to face the crash site.
  return { x: CRASH.x + 400 * Math.cos(a), y: CRASH.y + 400 * Math.sin(a), rotate: deg - 90 };
});

function ProblemSlide({ reduced }: SlideProps) {
  const step = useSteps(SWARM, 560, 1100, 1800, reduced);
  return (
    <Frame label="The problem">
      <div className="flex h-full items-center justify-between">
        <div className="w-[1060px]">
          <Rise delay={0.1}>
            <div role="heading" aria-level={2} className="dk-display text-[130px]">Agents have no stop signal.</div>
          </Rise>
          <Rise delay={0.4} y={14} className="terminal mt-[44px] flex flex-col gap-[20px] rounded-[28px] px-[34px] py-[28px]">
            {WALLS.map((w) => (
              <div key={w.where} className="flex items-start gap-[18px]">
                <span className="mt-[2px] shrink-0 font-mono text-[25px] leading-[1.3] text-[#f6cf1b]">!</span>
                <div>
                  <div className="font-mono text-[25px] leading-[1.3] text-[#fff6c2]">{w.error}</div>
                  <div className="mt-[4px] font-mono text-[17px] uppercase tracking-[0.18em] text-[#f6cf1b]">{w.where}</div>
                </div>
              </div>
            ))}
          </Rise>
          <Rise delay={0.9}>
            <p className="dk-display mt-[40px] text-[44px] text-[#7a3f00]">
              Every agent pays again. The vendor never finds out.
            </p>
          </Rise>
        </div>
        <div className="relative h-[620px] w-[620px] shrink-0">
          <div className="absolute left-[43px] top-[86px]">
            <Comb cols={5} rows={5} r={56} state={(c, r) => (c === 2 && r === 2 ? "hit" : "idle")} />
          </div>
          <svg viewBox="0 0 620 620" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
            {!reduced && step > 0 ? (
              <motion.circle
                key={`pulse-${step}`}
                cx={CRASH.x}
                cy={CRASH.y}
                fill="none"
                stroke={RED}
                strokeWidth={3}
                initial={{ r: 46, opacity: 0 }}
                animate={{ r: [46, 46, 120], opacity: [0, 0.9, 0] }}
                transition={{ duration: 0.95, times: [0, 0.5, 1], ease: "easeOut" }}
              />
            ) : null}
          </svg>
          {/* The swarm: photographed bees, each flying into the same crash site. */}
          {STARTS.slice(0, step).map((s, i) => (
            <motion.img
              key={i}
              src="/art/bee-320.jpg"
              alt=""
              width={BEE}
              height={BEE}
              className="dk-bee absolute left-0 top-0 max-w-none"
              style={{ width: BEE, height: BEE }}
              initial={{ x: s.x - BEE / 2, y: s.y - BEE / 2, rotate: s.rotate, opacity: reduced ? 0 : 1 }}
              animate={{ x: CRASH.x - BEE / 2, y: CRASH.y - BEE / 2, rotate: s.rotate, opacity: [1, 1, 0] }}
              transition={{ duration: reduced ? 0 : 0.6, ease: "easeIn", times: [0, 0.85, 1] }}
            />
          ))}
          <div className="absolute inset-x-0 bottom-[-64px] flex items-baseline justify-center gap-[18px]">
            <span className="tabular-nums dk-display text-[76px] leading-none text-[#b80f26]">{step}</span>
            <span className="font-mono text-[20px] uppercase tracking-[0.18em] text-[#54491a]">down at the same site</span>
          </div>
        </div>
      </div>
    </Frame>
  );
}

// ----------------------------------------------------------------- 4 loop

// Drawn rather than typed, so it does not depend on the font having the glyph.
const ARROW = (
  <svg width="0.85em" height="0.6em" viewBox="0 0 34 24" className="mx-[0.1em] inline-block" role="img" aria-label="then">
    <path d="M1 12 H31 M21 2 L31 12 L21 22" fill="none" stroke="currentColor" strokeWidth="4" />
  </svg>
);

const LOOP: { n: string; text: ReactNode; color: string; hex: string }[] = [
  { n: "1", text: <>Agent goes down {ARROW} mayday</>, color: RED, hex: RED },
  { n: "2", text: "Postgres finds the crash site", color: INK, hex: INK },
  { n: "3", text: "Briefing: the fix that worked, official fix first", color: HONEY, hex: HONEY },
  { n: "4", text: "Rescue confirmed, the best fix rises", color: INK, hex: WAX },
];

function LoopSlide({ reduced }: SlideProps) {
  const step = useSteps(4, 1150, 700, 3000, reduced);
  return (
    <Frame label="The loop">
      <div className="grid h-full grid-cols-4 content-center">
        {LOOP.map((s, i) => {
          const lit = step >= i + 1;
          return (
            <Rise key={s.n} delay={0.1 + i * 0.12} className="pr-[36px]">
              <div className="flex items-center gap-[20px]">
                <Hex size={132} color={s.hex} lit={lit} className="shrink-0" />
                {i < LOOP.length - 1 ? (
                  <div className="relative h-[24px] flex-1">
                    <div className="absolute inset-x-0 top-[10px] h-[4px] rounded-full bg-[#17130d]/15" />
                    <motion.div
                      className="absolute left-0 top-[10px] h-[4px] rounded-full"
                      style={{ background: INK }}
                      initial={{ width: "0%" }}
                      animate={{ width: step >= i + 2 ? "100%" : "0%" }}
                      transition={{ duration: reduced ? 0 : 0.6, ease: "easeInOut" }}
                    />
                    <svg width="16" height="24" viewBox="0 0 16 24" className="absolute right-[-2px] top-0 overflow-visible" aria-hidden>
                      <motion.path
                        d="M2 2 L14 12 L2 22"
                        fill="none"
                        strokeWidth={4}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        initial={{ stroke: LINE }}
                        animate={{ stroke: step >= i + 2 ? INK : LINE }}
                        transition={{ duration: 0.3, delay: step >= i + 2 && !reduced ? 0.5 : 0 }}
                      />
                    </svg>
                  </div>
                ) : null}
              </div>
              <motion.div
                className="dk-display tabular-nums mt-[44px] text-[168px] leading-none"
                initial={{ color: DIM }}
                animate={{ color: lit ? s.color : DIM }}
                transition={{ duration: 0.4 }}
              >
                {s.n}
              </motion.div>
              <motion.p
                className="dk-display mt-[26px] text-[46px] leading-[1.12]"
                initial={{ color: DIM }}
                animate={{ color: lit ? INK : DIM }}
                transition={{ duration: 0.4 }}
              >
                {s.text}
              </motion.p>
            </Rise>
          );
        })}
      </div>
    </Frame>
  );
}

// ----------------------------------------------------------------- 5 live

function LiveNumber({
  label,
  value,
  color,
  delay,
  reduced,
}: {
  label: string;
  value: number | null;
  color: string;
  delay: number;
  reduced: boolean;
}) {
  const shown = useCountUp(value ?? 0, 1500, reduced);
  return (
    <Rise delay={delay} className="rounded-[32px] border border-[#17130d]/15 bg-[#f9db4a] px-[32px] py-[26px]">
      <div className="font-mono text-[20px] uppercase tracking-[0.18em] text-[#54491a]">{label}</div>
      <div className="tabular-nums dk-display mt-[10px] text-[140px] leading-none" style={{ color }}>
        {value === null ? "—" : shown.toLocaleString("en-US")}
      </div>
    </Rise>
  );
}

function LiveSlide({ reduced, map }: SlideProps) {
  const ok = map.status === "ok" ? map : null;
  return (
    <Frame label="Live">
      <div className="flex h-full flex-col justify-center">
        <Rise delay={0.1} className="flex items-center gap-[36px]">
          <div role="heading" aria-level={2} className="dk-display text-[150px]">Watch one go down.</div>
          <span className="relative mt-[20px] inline-flex h-[30px] w-[30px]">
            <span className="absolute inset-0 dk-blip rounded-full bg-[#b80f26]" />
            <span className="relative h-[30px] w-[30px] rounded-full bg-[#b80f26]" />
          </span>
        </Rise>
        <div className="mt-[40px] grid grid-cols-4 gap-[28px]">
          <LiveNumber label="Total maydays" value={ok ? ok.maydays : null} color={RED} delay={0.3} reduced={reduced} />
          <LiveNumber label="Rescues" value={ok ? ok.rescues : null} color={INK} delay={0.4} reduced={reduced} />
          <LiveNumber label="Crash sites" value={ok ? ok.sites : null} color={INK} delay={0.5} reduced={reduced} />
          <LiveNumber label="Vendors" value={ok ? ok.vendors : null} color={INK} delay={0.6} reduced={reduced} />
        </div>
        <Rise delay={0.75} y={10} className="mt-[24px] flex items-center font-mono text-[20px] uppercase tracking-[0.14em] text-[#54491a]">
          {map.status === "error" ? (
            <span className="text-[#b80f26]">
              Live numbers could not be loaded here. They are on screen at the address below.
            </span>
          ) : (
            <>
              <span className="terminal rounded-full px-[18px] py-[6px] normal-case tracking-[0.02em]">GET /api/v1/map</span>
              <span className="ml-[18px]">includes charted sites; live and test-flight traffic is marked</span>
            </>
          )}
        </Rise>
        <Rise delay={0.85} y={12}>
          <p className="mt-[24px] max-w-[1640px] text-[30px] font-semibold leading-[1.25] tracking-[-0.015em] text-[#17130d]">
            In a real test flight today, the first agent charted a new crash site and left a fix; the next agent got
            that fix from Mayday.
          </p>
        </Rise>
        <Rise delay={0.95} className="mt-[32px] flex">
          <a
            data-no-nav
            href={LIVE_URL}
            target="_blank"
            rel="noreferrer"
            className="dk-display rounded-full bg-[#17130d] px-[48px] py-[18px] text-[58px] text-[#f6cf1b] hover:bg-[#17130d]/85"
          >
            {LIVE_URL.replace("https://", "")}
          </a>
        </Rise>
      </div>
    </Frame>
  );
}

// --------------------------------------------------------------- 6 vendor

const TOWER_POINTS = [
  "See where agents crash on your product, ranked by agents down and hours lost",
  "Incidents: spikes detected against each site's own baseline",
  "Official fixes drafted by AI from the black boxes, reviewed by the vendor",
  "Pin the official fix at the exact crash site",
  "Pay per rescue, through Stripe. Only when the fix works.",
];
const SKETCH = ["82%", "70%", "64%", "52%", "44%"];

function VendorSlide({ reduced, map }: SlideProps) {
  const step = useSteps(1, 600, 2100, 0, reduced);
  const rows = map.status === "ok" && map.top.length >= 5 ? map.top.slice(0, 5) : null;
  const pinned = step >= 1;
  return (
    <Frame label="The vendor side">
      <div className="flex h-full items-center justify-between">
        <div className="w-[850px]">
          <Rise delay={0.1}>
            <div role="heading" aria-level={2} className="dk-display text-[112px]">Every vendor gets a tower.</div>
          </Rise>
          <div className="mt-[40px] flex flex-col gap-[18px]">
            {TOWER_POINTS.map((p, i) => (
              <Rise key={p} delay={0.4 + i * 0.13} y={14} className="flex items-start gap-[18px]">
                <Hex size={20} color={i === 1 ? RED : i === 2 ? HONEY : INK} className="mt-[11px] shrink-0" />
                <p className="text-[31px] font-medium leading-[1.24] tracking-[-0.015em] text-[#17130d]">{p}</p>
              </Rise>
            ))}
          </div>
        </div>
        <div className="w-[790px] shrink-0 rounded-[36px] border border-[#17130d]/15 bg-[#f9db4a] px-[28px] pb-[22px] pt-[26px]">
          <Rise delay={0.3} y={10} className="flex border-b border-[#17130d]/15 pb-[14px] font-mono text-[15px] uppercase tracking-[0.12em] whitespace-nowrap text-[#54491a]">
            <span className="w-[56px]">#</span>
            <span className="flex-1">Crash site</span>
            <span className="w-[140px] text-right">Agents down</span>
            <span className="w-[140px] text-right">Hours lost</span>
          </Rise>
          {SKETCH.map((width, i) => {
            const row = rows ? rows[i] : null;
            const mark = i === 0 && pinned;
            return (
              <Rise key={i} delay={0.45 + i * 0.1} y={16}>
                <motion.div
                  className="relative flex items-center rounded-[14px] border-b border-[#17130d]/15 py-[20px]"
                  initial={{ backgroundColor: "rgba(122,63,0,0)" }}
                  animate={{ backgroundColor: mark ? "rgba(122,63,0,0.13)" : "rgba(122,63,0,0)" }}
                  transition={{ duration: 0.5 }}
                >
                  <motion.span
                    className="absolute inset-y-[10px] left-0 w-[5px] rounded-full bg-[#7a3f00]"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: mark ? 1 : 0 }}
                    transition={{ duration: 0.3 }}
                  />
                  <span className="tabular-nums w-[56px] pl-[18px] font-mono text-[23px] text-[#54491a]">{i + 1}</span>
                  <div className="min-w-0 flex-1 pr-[18px]">
                    {row ? (
                      <div className="truncate text-[28px] font-semibold tracking-[-0.01em] text-[#17130d]">{row.title}</div>
                    ) : (
                      <div className="h-[14px] rounded-full bg-[#17130d]/20" style={{ width }} />
                    )}
                    <div className="mt-[8px] flex h-[26px] items-center gap-[14px] font-mono text-[16px] uppercase tracking-[0.16em] text-[#54491a]">
                      {row ? <span>{row.vendor}</span> : <span className="h-[8px] w-[90px] rounded-full bg-[#17130d]/10" />}
                      {i === 0 ? (
                        <motion.span
                          className="flex items-center gap-[8px] font-semibold text-[#7a3f00]"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: pinned ? 1 : 0 }}
                          transition={{ duration: 0.4 }}
                        >
                          <Hex size={16} color={HONEY} />
                          Official fix
                        </motion.span>
                      ) : null}
                    </div>
                  </div>
                  <span className="tabular-nums w-[140px] text-right text-[34px] font-bold text-[#b80f26]">
                    {row ? row.maydays.toLocaleString("en-US") : <span className="inline-block h-[14px] w-[70px] rounded-full bg-[#b80f26]/50" />}
                  </span>
                  <span className="tabular-nums w-[140px] pr-[14px] text-right text-[34px] font-bold text-[#17130d]">
                    {row ? row.hours.toLocaleString("en-US") : <span className="inline-block h-[14px] w-[56px] rounded-full bg-[#17130d]/20" />}
                  </span>
                </motion.div>
              </Rise>
            );
          })}
          {rows ? (
            <Rise delay={1.1} y={8} className="mt-[16px] font-mono text-[15px] uppercase tracking-[0.16em] text-[#54491a]">
              Top crash sites right now, from /api/v1/map
            </Rise>
          ) : null}
        </div>
      </div>
    </Frame>
  );
}

// ------------------------------------------------ 7 not just stop signals

const SIGNALS = [
  {
    key: "stop",
    name: "Stop signal",
    line: "Don't go down that path.",
    color: RED,
    points: [
      "Maydays: an agent goes down and says where",
      "Crash sites: the same failure, matched and counted",
      "Rescues: the fix that worked, confirmed by the agent it saved",
    ],
  },
  {
    key: "waggle",
    name: "Waggle dance",
    line: "Fly this way instead.",
    color: HONEY,
    points: [
      "Proven routes: agents ask for the known good path before they start",
      "Landings: they report when the route got them there",
      "New routes: they chart the ones nobody has flown yet",
    ],
  },
];

// The waggle dance is a figure of eight with a straight run up the middle.
const EIGHT = "M117 118 C60 118 30 96 30 75 C30 54 60 32 117 32 C174 32 204 54 204 75 C204 96 174 118 117 118";
const WAGGLE = "M117 118 L107 104 L127 90 L107 76 L127 62 L107 48 L117 32";

function SignalsSlide({ reduced }: SlideProps) {
  const step = useSteps(3, 950, 900, 2600, reduced);
  const cell = (c: number, r: number): CellState => {
    const d = hexDist(c, r, 1, 1);
    if (d === 0) return step >= 1 ? "hit" : "idle";
    if (d === 1) return step >= 3 ? "wax" : step >= 2 ? "honey" : "idle";
    return "idle";
  };
  return (
    <Frame label="Not just stop signals">
      <div className="flex h-full flex-col justify-center">
        <Rise delay={0.1} className="flex items-end justify-between gap-[40px]">
          <div role="heading" aria-level={2} className="dk-display text-[116px]">Not just stop signals.</div>
          <span className="mb-[16px] inline-flex shrink-0 items-center gap-[12px] rounded-full border-[2px] border-[#17130d] px-[20px] py-[8px] font-mono text-[17px] uppercase tracking-[0.16em] text-[#17130d]">
            <Hex size={18} color={HONEY} />
            Airworthiness · the rating that can&rsquo;t be bought
          </span>
        </Rise>
        <div className="mt-[34px] grid grid-cols-2 gap-[32px]">
          {SIGNALS.map((s, i) => (
            <Rise
              key={s.key}
              delay={0.3 + i * 0.18}
              className="relative rounded-[40px] border border-[#17130d]/15 bg-[#f9db4a] px-[40px] pb-[36px] pt-[34px]"
            >
              <div className="flex items-start justify-between">
                <div>
                  <span className={PILL_DARK}>
                    <Hex size={18} color={s.key === "stop" ? RED : DECK_COLORS.field} />
                    {s.name}
                  </span>
                  <p className="dk-display mt-[24px] text-[56px]" style={{ color: s.color }}>
                    {s.line}
                  </p>
                </div>
                <div className="h-[150px] w-[234px] shrink-0">
                  {s.key === "stop" ? (
                    <Comb cols={4} rows={3} r={30} inset={3} state={cell} />
                  ) : (
                    <svg viewBox="0 0 234 150" className="h-full w-full overflow-visible" aria-hidden>
                      <path d={EIGHT} fill="none" stroke={LINE} strokeWidth={5} strokeLinecap="round" />
                      <motion.path
                        d={EIGHT}
                        fill="none"
                        stroke={HONEY}
                        strokeWidth={5}
                        strokeLinecap="round"
                        initial={{ pathLength: reduced ? 1 : 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 2.2, delay: 0.8, ease: "easeInOut", repeat: reduced ? 0 : Infinity, repeatDelay: 1.6 }}
                      />
                      <motion.path
                        d={WAGGLE}
                        fill="none"
                        stroke={INK}
                        strokeWidth={5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        initial={{ pathLength: reduced ? 1 : 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 1, delay: 0.5, ease: "easeInOut", repeat: reduced ? 0 : Infinity, repeatDelay: 2.8 }}
                      />
                    </svg>
                  )}
                </div>
              </div>
              <div className="mt-[26px] flex flex-col gap-[14px]">
                {s.points.map((p) => (
                  <div key={p} className="flex items-start gap-[16px]">
                    <Hex size={18} color={s.color} className="mt-[11px] shrink-0" />
                    <p className="text-[30px] font-medium leading-[1.24] tracking-[-0.015em] text-[#17130d]">{p}</p>
                  </div>
                ))}
              </div>
            </Rise>
          ))}
        </div>
        <Rise delay={0.8} y={12} className="mt-[30px] flex items-center gap-[20px]">
          <span className={`${PILL} shrink-0`}>Vaccination</span>
          <p className="text-[32px] font-semibold tracking-[-0.015em] text-[#17130d]">
            The plugin briefs an agent on its project&rsquo;s stack before it writes a line.
          </p>
        </Rise>
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------- 8 built

const STACK = [
  {
    name: "Supabase",
    text: "Postgres does the matching (pg_trgm + error codes). RLS is the permission model. Realtime is the UI.",
  },
  { name: "Vercel", text: "Next.js 16, the MCP server, deploys in seconds." },
  { name: "Stripe", text: "Checkout to claim an airspace. Billing Meters for pay-per-rescue." },
  { name: "Claude", text: "Claude Code plugin hook, the MCP tools, test flights flown by real agents." },
  { name: "Google Gemini", text: "Drafts official fixes and generated the artwork." },
];

const NODES = [
  { x: 2, y: 8, w: 250, h: 96, title: "AGENT", sub: "hook · MCP" },
  { x: 432, y: 8, w: 330, h: 96, title: "VERCEL", sub: "Next.js 16 · MCP" },
  { x: 942, y: 8, w: 330, h: 96, title: "POSTGRES", sub: "match · count · brief" },
  { x: 1452, y: 8, w: 246, h: 96, title: "REALTIME", sub: "radar · tower" },
  { x: 942, y: 180, w: 330, h: 96, title: "STRIPE", sub: "Checkout · Meters" },
];
const WIRES = [
  { d: "M252 56 H424", head: "424,56", label: "mayday", lx: 338, ly: 40, color: RED },
  { d: "M762 56 H934", head: "934,56", label: "one SQL call", lx: 848, ly: 40, color: INK },
  { d: "M1272 56 H1444", head: "1444,56", label: "changes", lx: 1358, ly: 40, color: INK },
  { d: "M597 104 V228 H934", head: "934,228", label: "per rescue", lx: 770, ly: 212, color: INK },
];

function BuiltSlide({ reduced }: SlideProps) {
  const t = (d: number) => (reduced ? 0 : d);
  return (
    <Frame label="How it's built">
      <div className="flex h-full flex-col justify-center">
        <svg viewBox="0 0 1700 284" className="h-[284px] w-[1700px]" aria-hidden>
          {NODES.map((n, i) => (
            <g key={n.title}>
              <motion.rect
                x={n.x}
                y={n.y}
                width={n.w}
                height={n.h}
                rx={22}
                fill={n.title === "POSTGRES" ? WAX : PANEL}
                stroke={INK}
                strokeWidth={n.title === "POSTGRES" ? 4 : 2.5}
                initial={{ pathLength: reduced ? 1 : 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: t(0.7), delay: t(0.2 + i * 0.3), ease: "easeInOut" }}
              />
              <motion.g
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: t(0.4), delay: t(0.5 + i * 0.3) }}
              >
                <text x={n.x + 24} y={n.y + 42} fontSize={25} fontWeight={700} letterSpacing="0.16em" fill={INK} className="font-mono">
                  {n.title}
                </text>
                <text x={n.x + 24} y={n.y + 76} fontSize={20} letterSpacing="0.04em" fill={MUTE} className="font-mono">
                  {n.sub}
                </text>
              </motion.g>
            </g>
          ))}
          {WIRES.map((w, i) => (
            <g key={w.label}>
              <motion.path
                d={w.d}
                fill="none"
                stroke={w.color}
                strokeWidth={3}
                initial={{ pathLength: reduced ? 1 : 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: t(0.5), delay: t(0.55 + i * 0.3), ease: "easeInOut" }}
              />
              <motion.g
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: t(0.3), delay: t(1 + i * 0.3) }}
              >
                <circle cx={Number(w.head.split(",")[0])} cy={Number(w.head.split(",")[1])} r={7} fill={w.color} />
                <text x={w.lx} y={w.ly} fontSize={18} fontWeight={700} letterSpacing="0.14em" fill={w.color} textAnchor="middle" className="font-mono uppercase">
                  {w.label}
                </text>
              </motion.g>
            </g>
          ))}
        </svg>
        <div className="mt-[44px] grid grid-cols-[1fr_1fr_1fr_1fr_0.8fr] gap-[30px]">
          {STACK.map((s, i) => {
            const small = i === STACK.length - 1;
            return (
              <Rise key={s.name} delay={0.5 + i * 0.14} className="border-t-[3px] border-[#17130d] pt-[20px]">
                <div
                  className={`flex items-center gap-[12px] font-mono font-bold uppercase tracking-[0.18em] text-[#17130d] ${small ? "text-[19px]" : "text-[23px]"}`}
                >
                  <Hex size={small ? 15 : 18} color={small ? HONEY : INK} />
                  {s.name}
                </div>
                <p
                  className={`mt-[16px] font-medium leading-[1.26] tracking-[-0.012em] ${small ? "text-[24px] text-[#54491a]" : "text-[28px] text-[#17130d]"}`}
                >
                  {s.text}
                </p>
              </Rise>
            );
          })}
        </div>
        <Rise delay={1.2} y={10} className="mt-[38px] flex">
          <span className="terminal rounded-full px-[28px] py-[12px] font-mono text-[24px] tracking-[0.02em]">
            A mayday is one SQL transaction.
          </span>
        </Rise>
      </div>
    </Frame>
  );
}

// ------------------------------------------------------------- 9 business

const BUSINESS = [
  { word: "Find", text: "test flights + live maydays", hex: RED },
  { word: "Fix", text: "the official fix, delivered at the moment of failure", hex: HONEY },
  { word: "Prove", text: "airworthiness and a per-rescue bill", hex: WAX },
];

function BusinessSlide({ reduced }: SlideProps) {
  const step = useSteps(3, 900, 1000, 3200, reduced);
  return (
    <Frame label="The business">
      <div className="flex h-full flex-col justify-center">
        <Rise delay={0.1}>
          <div role="heading" aria-level={2} className="dk-display max-w-[1640px] text-[108px]">
            Vendors already pay to stop developers failing on their product.
          </div>
        </Rise>
        <div className="relative mt-[44px] flex flex-col gap-[22px]">
          <motion.div
            className="absolute left-[32px] top-[39px] w-[3px] bg-[#17130d]/20"
            initial={{ height: reduced ? 200 : 0 }}
            animate={{ height: 200 }}
            transition={{ duration: 1.2, delay: 0.5, ease: "easeInOut" }}
          />
          {BUSINESS.map((b, i) => {
            const lit = step >= i + 1;
            return (
              <Rise key={b.word} delay={0.4 + i * 0.16} y={14} className="relative flex items-center gap-[36px]">
                <Hex size={78} color={b.hex} lit={lit} className="shrink-0" />
                <motion.span
                  className="dk-display w-[250px] text-[72px]"
                  initial={{ color: DIM }}
                  animate={{ color: lit ? INK : DIM }}
                  transition={{ duration: 0.4 }}
                >
                  {b.word}
                </motion.span>
                <span className="text-[44px] font-medium tracking-[-0.018em] text-[#54491a]">{b.text}</span>
              </Rise>
            );
          })}
        </div>
        <Rise delay={1}>
          <p className="dk-display mt-[44px] text-[52px] text-[#7a3f00]">
            Day-one value with zero network: launch a test flight.
          </p>
        </Rise>
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------- 10 close

function CloseSlide({ reduced }: SlideProps) {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <motion.img
        src="/art/comb.jpg"
        alt=""
        width={1376}
        height={768}
        loading="eager"
        decoding="async"
        className="absolute inset-0 h-full w-full max-w-none object-cover"
        initial={{ opacity: 0, scale: reduced ? 1 : 1.06 }}
        animate={{ opacity: 0.4, scale: 1 }}
        transition={{ duration: 1.6, ease: EASE }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(90deg, #f6cf1b 0%, rgba(246,207,27,0.86) 40%, rgba(246,207,27,0.5) 74%, rgba(246,207,27,0.2) 100%)",
        }}
      />
      <div className="absolute inset-0 flex flex-col justify-center px-[110px] pb-[60px]">
        <Rise y={10} className="flex">
          <span className={PILL_DARK}>
            <Hex size={20} color={DECK_COLORS.field} />
            Mayday
          </span>
        </Rise>
        <Rise delay={0.15}>
          <div role="heading" aria-level={2} className="dk-display mt-[36px] max-w-[1600px] text-[124px]">
            Every agent that goes down should be the last one to go down there.
          </div>
        </Rise>
        <Rise delay={0.6} className="mt-[64px] flex flex-col items-start gap-[22px]">
          <a
            data-no-nav
            href={LIVE_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-full bg-[#17130d] px-[40px] py-[16px] font-mono text-[40px] font-bold tracking-[-0.01em] text-[#f6cf1b] hover:bg-[#17130d]/85"
          >
            {LIVE_URL}
          </a>
          <a
            data-no-nav
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border-[3px] border-[#17130d] bg-[#f6cf1b]/70 px-[40px] py-[13px] font-mono text-[40px] font-bold tracking-[-0.01em] text-[#17130d] hover:bg-[#17130d] hover:text-[#f6cf1b]"
          >
            {REPO_URL}
          </a>
        </Rise>
      </div>
    </div>
  );
}

export const SLIDES: ((props: SlideProps) => ReactNode)[] = [
  TitleSlide,
  HoneybeeSlide,
  ProblemSlide,
  LoopSlide,
  LiveSlide,
  VendorSlide,
  SignalsSlide,
  BuiltSlide,
  BusinessSlide,
  CloseSlide,
];

export { LINE as DECK_LINE };
