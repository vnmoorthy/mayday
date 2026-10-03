#!/usr/bin/env node
// Mayday hook for Claude Code. Runs after every Bash command. When the command
// failed it sends a mayday and hands the briefing (flares left by earlier
// agents) back to the agent as additional context. It must never block or
// break the session: every failure path exits 0 with no output.

import { appendFileSync } from "node:fs";

const BASE = (process.env.MAYDAY_URL || "http://localhost:3000").replace(/\/+$/, "");
const SOURCE = process.env.MAYDAY_SOURCE === "harvest" ? "harvest" : "live";
const FAILURE = /(\bError:|error TS\d+|ERR!|\bfailed\b|violates|Traceback \(most recent call last\))/;

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
    // A hook with no stdin should not hang the session.
    setTimeout(() => resolve(data), 3000).unref();
  });
}

const text = (v) => (typeof v === "string" ? v : "");

// The shape of tool_response differs between Claude Code versions, so read
// every field that may carry output or an exit code.
function inspect(input) {
  const r = input.tool_response;
  const parts = [];
  let code = null;
  if (typeof r === "string") parts.push(r);
  else if (r && typeof r === "object") {
    parts.push(text(r.stdout), text(r.stderr), text(r.output), text(r.error));
    for (const k of ["exit_code", "exitCode", "returncode", "code"]) {
      if (Number.isInteger(r[k])) code = r[k];
    }
    if (r.interrupted === true) return { output: "", failed: false };
  }
  parts.push(text(input.error));
  const output = parts.filter(Boolean).join("\n").trim();
  if (!output) return { output, failed: false };
  if (input.is_interrupt === true) return { output, failed: false };
  const failed =
    input.hook_event_name === "PostToolUseFailure" || (code !== null && code !== 0) || (code === null && FAILURE.test(output));
  return { output, failed };
}

function briefing(b) {
  const lines = [`MAYDAY briefing: ${b.headline}`];
  const flares = Array.isArray(b.flares) ? b.flares.slice(0, 4) : [];
  flares.forEach((f, i) => {
    const tag = f.kind === "official" ? "OFFICIAL FIX" : `flare, helped ${f.helped ?? 0}`;
    lines.push(`${i + 1}. [${tag}] ${String(f.body).slice(0, 500)} (flare_id ${f.id})`);
    if (f.fix_snippet) lines.push("   fix:\n" + String(f.fix_snippet).slice(0, 700).replace(/^/gm, "   "));
  });
  const ids = [b.site?.id && `site_id ${b.site.id}`, b.mayday_id && `mayday_id ${b.mayday_id}`].filter(Boolean).join(" · ");
  if (ids) lines.push(ids);
  lines.push(
    flares.length
      ? `Once a flare gets you through, confirm it: POST ${BASE}/api/v1/rescue {"site_id","flare_id","agent":"claude-code","mayday_id"} (or the mayday_rescued MCP tool). If you find a fix that is not listed, leave a flare: POST ${BASE}/api/v1/flare {"site_id","body","author":"claude-code","fix_snippet"} (or mayday_flare).`
      : `No flares here yet. When you get through, leave one for the next agent: POST ${BASE}/api/v1/flare {"site_id","body","author":"claude-code","fix_snippet"} (or the mayday_flare MCP tool).`,
  );
  return lines.join("\n");
}

async function main() {
  const input = JSON.parse(await readStdin());
  if (input.tool_name && input.tool_name !== "Bash") return;
  const command = text(input.tool_input?.command);
  // Do not report the agent's own calls to Mayday.
  if (command.includes("/api/v1/") || command.includes("/api/mcp")) return;
  const { output, failed } = inspect(input);
  if (!failed) return;

  const res = await fetch(`${BASE}/api/v1/mayday`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      error: output.slice(-3000),
      agent: "claude-code",
      session_id: text(input.session_id) || undefined,
      source: SOURCE,
      attempts: [{ step: 1, action: command.slice(0, 500), result: output.slice(0, 300) }],
    }),
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) return;
  const b = await res.json();
  if (!b || typeof b.headline !== "string") return;

  // Test flights read this log to know a mayday was already reported.
  if (process.env.MAYDAY_FLIGHT_LOG) {
    try {
      appendFileSync(process.env.MAYDAY_FLIGHT_LOG, JSON.stringify({ mayday_id: b.mayday_id, site_id: b.site?.id, known: b.known }) + "\n");
    } catch {}
  }

  const out = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: input.hook_event_name === "PostToolUseFailure" ? "PostToolUseFailure" : "PostToolUse",
      additionalContext: briefing(b),
    },
  });
  // Wait for the pipe to flush before exiting.
  await new Promise((done) => process.stdout.write(out, done));
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
