#!/usr/bin/env node
// Mayday vaccination for Claude Code. Runs once at session start: reads the
// project's package.json, asks Mayday which crash sites other agents hit on
// that stack, and hands the fixes to the agent before it makes the first
// mistake. It must never block or break a session: every failure path, a
// missing package.json and an unknown stack all exit 0 with no output.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const BASE = (process.env.MAYDAY_URL || "https://mayday-alpha-eight.vercel.app").replace(/\/+$/, "");
// 4 seconds by default: a slow Mayday must not hold up the start of a session.
const TIMEOUT_MS = Number(process.env.MAYDAY_TIMEOUT_MS) > 0 ? Number(process.env.MAYDAY_TIMEOUT_MS) : 4000;
const LEAD =
  "Mayday preflight: other agents have gone down on this project's stack. Known crash sites and the fixes that worked:";

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
    // A hook with no stdin should not hang the session.
    setTimeout(() => resolve(data), 1500).unref();
  });
}

async function main() {
  let input = {};
  try {
    input = JSON.parse((await readStdin()) || "{}") || {};
  } catch {
    input = {};
  }
  const cwd = typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd();

  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
  } catch {
    return; // no package.json here, or it is not JSON
  }
  const names = [
    ...new Set([...Object.keys(pkg?.dependencies ?? {}), ...Object.keys(pkg?.devDependencies ?? {})]),
  ].slice(0, 400);
  if (!names.length) return;

  const res = await fetch(`${BASE}/api/v1/vaccine`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dependencies: names }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return;
  const data = await res.json();
  const briefing = typeof data?.briefing === "string" ? data.briefing.trim() : "";
  if (!briefing || !Array.isArray(data?.vendors) || !data.vendors.length) return;

  const out = JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: `${LEAD}\n${briefing}` },
  });
  // Wait for the write to flush before main() resolves and the process exits.
  await new Promise((done) => process.stdout.write(out, done));
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
