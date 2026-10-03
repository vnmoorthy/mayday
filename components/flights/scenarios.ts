import "server-only";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

// The trap scenarios a test flight can run. Read from flights/ on disk at
// request time; a deployed build may not ship that directory, so there is a
// static list of the same three scenarios to fall back on.

export type FlightScenario = {
  name: string;
  title: string;
  description: string;
  vendor: string;
  surface: string;
};

const FALLBACK: FlightScenario[] = [
  {
    name: "stripe-webhook",
    title: "Stripe webhook rejects every signed event",
    description:
      "A webhook handler re-serializes the parsed JSON body before verifying it, so Stripe's signature check fails on every event.",
    vendor: "stripe",
    surface: "webhooks.constructEvent",
  },
  {
    name: "next-redirect",
    title: "Next.js proxy crashes when it redirects to the login page",
    description: "A Next.js proxy redirects with a relative path, which NextResponse.redirect refuses: it only takes absolute URLs.",
    vendor: "vercel",
    surface: "NextResponse.redirect",
  },
  {
    name: "supabase-client",
    title: "Supabase client fails to start: supabaseUrl is required",
    description:
      "The client reads SUPABASE_URL while the project defines NEXT_PUBLIC_SUPABASE_URL, so createClient gets undefined and throws.",
    vendor: "supabase",
    surface: "createClient",
  },
];

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function readScenario(dir: string, name: string): Promise<FlightScenario | null> {
  let task: string;
  try {
    task = await readFile(path.join(dir, name, "TASK.md"), "utf8");
  } catch {
    return null; // not a scenario directory
  }
  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(await readFile(path.join(dir, name, "flight.json"), "utf8")) as Record<string, unknown>;
  } catch {
    // flight.json is optional: the title comes from TASK.md.
  }
  const heading = task.split("\n").find((line) => line.startsWith("# "));
  const firstParagraph = task
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !p.startsWith("#"));
  return {
    name,
    title: text(heading?.slice(2), 160) || text(meta.title, 160) || name,
    description: text(meta.description, 400) || text(firstParagraph?.replace(/\s+/g, " "), 400),
    vendor: text(meta.vendor, 60) || "unknown",
    surface: text(meta.surface, 160),
  };
}

export async function getFlightScenarios(): Promise<{ scenarios: FlightScenario[]; fromDisk: boolean }> {
  try {
    const dir = path.join(process.cwd(), "flights");
    const entries = await readdir(dir, { withFileTypes: true });
    const names = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();
    const found = (await Promise.all(names.map((n) => readScenario(dir, n)))).filter((s): s is FlightScenario => s !== null);
    if (found.length) return { scenarios: found, fromDisk: true };
  } catch {
    // No flights/ directory in this deployment.
  }
  return { scenarios: FALLBACK, fromDisk: false };
}
