// Small formatting helpers shared by server and client components.

export function timeAgo(iso: string, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function minutesToHuman(minutes: number): string {
  if (minutes < 1) return "0m";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = minutes / 60;
  if (h < 100) return `${h.toFixed(1)}h`;
  return `${Math.round(h).toLocaleString()}h`;
}

export function rescueRate(maydays: number, rescues: number): number {
  if (!maydays) return 0;
  return Math.min(100, Math.round((rescues / maydays) * 100));
}

export function compact(n: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function dollars(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

// Deterministic 0..1 pseudo-random from a string, for stable blip placement.
export function hash01(input: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}
