"use client";
import { useEffect, useRef } from "react";

// The swarm: honeybees wandering across the whole page, behind the content.
// Each bee is the same macro photograph, drawn on one canvas. The photo sits
// on white, so on load its whiteness is converted to transparency once; after
// that a bee is a single drawImage call. Each bee steers with a slowly turning
// heading, so the motion reads as flight, not noise.

type BeeState = { x: number; y: number; heading: number; turn: number; speed: number; size: number; phase: number };

const SPRITE = "/art/bee-320.jpg";

// White becomes transparent, and the colour is un-blended from white so wings
// stay translucent instead of grey.
function cutOut(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const x = c.getContext("2d", { willReadFrequently: true });
  if (!x) return c;
  x.drawImage(img, 0, 0);
  const data = x.getImageData(0, 0, c.width, c.height);
  const p = data.data;
  for (let i = 0; i < p.length; i += 4) {
    const min = Math.min(p[i], p[i + 1], p[i + 2]);
    const a = 1 - min / 255;
    if (a < 0.04) {
      p[i + 3] = 0;
      continue;
    }
    p[i] = Math.max(0, (p[i] - (1 - a) * 255) / a);
    p[i + 1] = Math.max(0, (p[i + 1] - (1 - a) * 255) / a);
    p[i + 2] = Math.max(0, (p[i + 2] - (1 - a) * 255) / a);
    p[i + 3] = Math.min(255, a * 300);
  }
  x.putImageData(data, 0, 0);
  return c;
}

export function Swarm({ count = 30 }: { count?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    let sprite: HTMLCanvasElement | null = null;
    let raf = 0;
    let stopped = false;

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const n = w < 640 ? Math.round(count / 2) : count;
    const bees: BeeState[] = Array.from({ length: n }, () => ({
      x: rand() * w,
      y: rand() * h,
      heading: rand() * Math.PI * 2,
      turn: (rand() - 0.5) * 0.02,
      speed: 1.4 + rand() * 2.2,
      size: 24 + rand() * 40,
      phase: rand() * 10,
    }));

    let frame = 0;
    const draw = () => {
      if (!sprite) return;
      ctx.clearRect(0, 0, w, h);
      ctx.shadowColor = "rgba(23, 19, 13, 0.28)";
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 6;
      for (const b of bees) {
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.heading + Math.PI / 2);
        // A slight squeeze across the wings reads as a wingbeat.
        const beat = reduced ? 1 : 0.86 + 0.14 * Math.sin(frame * 0.9 + b.phase);
        ctx.scale(beat, 1);
        // Smaller bees are further away: fainter, so the swarm has depth.
        ctx.globalAlpha = 0.38 + 0.34 * ((b.size - 24) / 40);
        ctx.drawImage(sprite, -b.size / 2, -b.size / 2, b.size, b.size);
        ctx.restore();
      }
    };

    const tick = () => {
      if (stopped) return;
      frame += 1;
      for (const b of bees) {
        if (frame % 24 === Math.floor(b.phase * 2.4) % 24) b.turn = (rand() - 0.5) * 0.06;
        b.heading += b.turn;
        b.x += Math.cos(b.heading) * b.speed;
        b.y += Math.sin(b.heading) * b.speed;
        const pad = b.size;
        if (b.x < -pad) b.x = w + pad;
        if (b.x > w + pad) b.x = -pad;
        if (b.y < -pad) b.y = h + pad;
        if (b.y > h + pad) b.y = -pad;
      }
      draw();
      raf = requestAnimationFrame(tick);
    };

    const img = new Image();
    img.onload = () => {
      sprite = cutOut(img);
      if (reduced) draw();
      else tick();
    };
    img.src = SPRITE;

    const onResize = () => {
      resize();
      if (reduced) draw();
    };
    window.addEventListener("resize", onResize);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [count]);

  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 h-full w-full" />;
}
