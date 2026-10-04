#!/usr/bin/env node
// Launches a test flight: a real Claude Code agent, run headlessly against one
// of the trap scenarios in flights/. With the Pioneer plugin loaded the agent
// reports its own stop signals through the hook; without it (or if the hook stayed
// silent) the flight leaves one summary stop signal with source "harvest".
//
//   node scripts/test-flight.mjs --scenario stripe-webhook [--runs 1] [--no-pioneer] [--url http://localhost:3000]

import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FLIGHTS = join(REPO, "flights");
const PLUGIN = join(REPO, "plugin");
const AGENT_TIMEOUT_MS = 4 * 60 * 1000;
const CHECK_TIMEOUT_MS = 60 * 1000;

function scenarios() {
  try {
    return readdirSync(FLIGHTS, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(FLIGHTS, d.name, ".orig", "TASK.md")))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

function usage() {
  const list = scenarios();
  return [
    "Pioneer test flight: run a real agent against a trap and record where it goes down.",
    "",
    "Usage:",
    "  node scripts/test-flight.mjs --scenario <name> [--runs 1] [--no-pioneer] [--url http://localhost:3000]",
    "",
    "Options:",
    "  --scenario <name>  scenario directory under flights/ (required)",
    "  --runs <n>         number of flights to launch, one after another (default 1)",
    "  --no-pioneer       fly without the Pioneer plugin: the control run, no briefings",
    "  --url <url>        Pioneer server to report to (default $PIONEER_URL or http://localhost:3000)",
    "  --model <model>    model passed to claude --model (default: your Claude Code default)",
    "  --keep             keep the temporary working copy after the flight",
    "  --help             show this help",
    "",
    `Scenarios: ${list.length ? list.join(", ") : "none found in flights/"}`,
    "",
    "Requires the claude CLI on PATH and a signed-in Claude Code. Each flight has a 4 minute limit.",
  ].join("\n");
}

function parseArgs(argv) {
  const o = { scenario: null, runs: 1, mayday: true, url: process.env.PIONEER_URL || "http://localhost:3000", model: null, keep: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--help" || a === "-h") o.help = true;
    else if (a === "--scenario") o.scenario = value();
    else if (a === "--runs") o.runs = Number(value());
    else if (a === "--no-pioneer") o.mayday = false;
    else if (a === "--url") o.url = value();
    else if (a === "--model") o.model = value();
    else if (a === "--keep") o.keep = true;
    else throw new Error(`Unknown option ${a}`);
  }
  if (!Number.isInteger(o.runs) || o.runs < 1 || o.runs > 50) throw new Error("--runs must be a whole number between 1 and 50");
  o.url = o.url.replace(/\/+$/, "");
  return o;
}

// Runs a command, collects its output, and kills it at the time limit.
function run(cmd, args, { cwd, env, timeoutMs }) {
  return new Promise((done) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let child;
    try {
      child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      return done({ code: null, stdout, stderr: String(err), timedOut, spawnError: err });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, timeoutMs);
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", (err) => {
      clearTimeout(timer);
      done({ code: null, stdout, stderr: String(err), timedOut, spawnError: err });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr, timedOut });
    });
  });
}

const check = (cwd) => run(process.execPath, ["check.mjs"], { cwd, env: process.env, timeoutMs: CHECK_TIMEOUT_MS });
const output = (r) => [r.stdout, r.stderr].filter(Boolean).join("\n").trim();
const seconds = (ms) => `${Math.round(ms / 1000)}s`;

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

function hookMaydays(logPath) {
  try {
    return readFileSync(logPath, "utf8").split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

async function postHarvest(url, body) {
  try {
    const res = await fetch(`${url}/api/v1/signal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, reason: json.error || `HTTP ${res.status}` };
    return { ok: true, mayday_id: json.mayday_id, site: json.site?.slug };
  } catch (err) {
    return { ok: false, reason: err?.cause?.code || err?.message || "request failed" };
  }
}

async function fly(o, n) {
  const orig = join(FLIGHTS, o.scenario, ".orig");
  const meta = readJson(join(orig, "flight.json"));
  const task = readFileSync(join(orig, "TASK.md"), "utf8");

  // Fresh working copy outside the repo, so the agent sees only the scenario.
  // The node_modules link lets the scenario import the SDKs installed here.
  const work = mkdtempSync(join(tmpdir(), `pioneer-flight-${o.scenario}-`));
  const logDir = mkdtempSync(join(tmpdir(), "pioneer-flight-log-"));
  const log = join(logDir, "maydays.jsonl");
  cpSync(orig, work, { recursive: true });
  symlinkSync(join(REPO, "node_modules"), join(work, "node_modules"), "dir");

  const before = await check(work);
  if (before.code === 0) console.warn(`  warning: ${o.scenario} passes before the agent starts, so the trap is not armed`);

  const args = ["-p", task, "--output-format", "json", "--permission-mode", "acceptEdits"];
  if (o.mayday) args.push("--plugin-dir", PLUGIN, "--allowedTools", "Bash,Read,Edit,Write,mcp__plugin_pioneer_pioneer");
  else args.push("--allowedTools", "Bash,Read,Edit,Write");
  if (o.model) args.push("--model", o.model);

  const env = { ...process.env, PIONEER_URL: o.url, PIONEER_SOURCE: "harvest", PIONEER_FLIGHT_LOG: log };
  const started = Date.now();
  const agent = await run("claude", args, { cwd: work, env, timeoutMs: AGENT_TIMEOUT_MS });
  const elapsed = Date.now() - started;

  if (agent.spawnError) {
    rmSync(work, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
    throw new Error(`Could not launch the claude CLI (${agent.spawnError.code || agent.spawnError.message}). Install Claude Code and make sure "claude" is on PATH.`);
  }

  let report = {};
  try {
    report = JSON.parse(agent.stdout);
  } catch {}
  const model = report.modelUsage ? Object.keys(report.modelUsage)[0] : o.model;

  // An agent that could not start (not signed in, no credit) never flew, so
  // there is no crash to record. Abort instead of logging a stop signal.
  if (report.is_error && !(report.total_cost_usd > 0)) {
    rmSync(work, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
    throw new Error(`The agent never took off: ${String(report.result || agent.stderr).slice(0, 200)}. Sign in with "claude" in your own terminal and launch the flight from there.`);
  }

  // The agent is told not to touch check.mjs; restore it so the verdict is honest.
  cpSync(join(orig, "check.mjs"), join(work, "check.mjs"));
  const after = await check(work);
  const passed = after.code === 0;

  const reported = o.mayday ? hookMaydays(log) : 0;
  const failedOnce = before.code !== 0 || !passed;
  let harvest = null;
  if (failedOnce && reported === 0) {
    const firstError = output(before.code !== 0 ? before : after);
    const agentResult = agent.timedOut
      ? "Timed out after 4 minutes."
      : typeof report.result === "string" && report.result
        ? report.result
        : `claude exited with code ${agent.code}. ${agent.stderr.slice(0, 200)}`;
    harvest = await postHarvest(o.url, {
      error: firstError.slice(-3000),
      vendor: meta.vendor,
      surface: meta.surface,
      agent: "claude-code",
      model: model || undefined,
      session_id: typeof report.session_id === "string" ? report.session_id : undefined,
      minutes_lost: Math.round((elapsed / 60000) * 10) / 10,
      source: "harvest",
      attempts: [
        { step: 1, action: "node check.mjs (before the agent started)", result: firstError.slice(0, 300) },
        {
          step: 2,
          action: `claude -p <TASK.md> ${o.mayday ? "with" : "without"} the Pioneer plugin, ${report.num_turns ?? "?"} turns, ${seconds(elapsed)}`,
          result: agentResult.slice(0, 300),
        },
        { step: 3, action: "node check.mjs (after the agent finished)", result: passed ? "PASS" : output(after).slice(0, 300) },
      ],
    });
  }

  const bits = [
    `flight ${n}/${o.runs}`,
    o.scenario,
    o.mayday ? "Pioneer on" : "Pioneer off",
    passed ? "PASS" : agent.timedOut ? "FAIL (timeout)" : "FAIL",
    seconds(elapsed),
    `${report.num_turns ?? "?"} turns`,
    typeof report.total_cost_usd === "number" ? `$${report.total_cost_usd.toFixed(2)}` : null,
    reported
      ? `${reported} stop signal${reported === 1 ? "" : "s"} via hook`
      : harvest
        ? harvest.ok
          ? `harvest stop signal ${harvest.mayday_id ?? "sent"}${harvest.site ? ` at ${harvest.site}` : ""}`
          : `harvest stop signal not sent (${harvest.reason})`
        : "no stop signal",
  ].filter(Boolean);
  console.log(bits.join("  ·  "));

  if (o.keep) console.log(`  working copy kept at ${work}`);
  else rmSync(work, { recursive: true, force: true });
  rmSync(logDir, { recursive: true, force: true });

  return { passed, elapsed, reported, harvested: Boolean(harvest?.ok), turns: report.num_turns ?? null, cost: report.total_cost_usd ?? 0 };
}

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${err.message}\n\n${usage()}`);
    process.exit(2);
  }
  if (o.help) {
    console.log(usage());
    return;
  }
  const list = scenarios();
  if (!o.scenario || !list.includes(o.scenario)) {
    console.error(`${o.scenario ? `Unknown scenario "${o.scenario}".` : "Missing --scenario."} Available: ${list.join(", ") || "none"}\n\n${usage()}`);
    process.exit(2);
  }

  console.log(`Test flight: ${o.scenario} · ${o.runs} run${o.runs === 1 ? "" : "s"} · ${o.mayday ? `Pioneer plugin on, reporting to ${o.url}` : `Pioneer plugin off, summary to ${o.url}`}`);
  const results = [];
  for (let n = 1; n <= o.runs; n++) results.push(await fly(o, n));

  const passed = results.filter((r) => r.passed).length;
  const avg = results.reduce((s, r) => s + r.elapsed, 0) / results.length;
  const hook = results.reduce((s, r) => s + r.reported, 0);
  const harvested = results.filter((r) => r.harvested).length;
  const cost = results.reduce((s, r) => s + (r.cost || 0), 0);
  console.log(
    `Summary: ${passed}/${results.length} landed · average ${seconds(avg)} · ${hook} stop signal${hook === 1 ? "" : "s"} via hook · ${harvested} harvest summar${harvested === 1 ? "y" : "ies"}${cost ? ` · $${cost.toFixed(2)}` : ""}`,
  );
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
