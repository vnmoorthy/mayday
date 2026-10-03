// Starts the app the way Next.js would: with the variables from env.example
// set, then imports the Supabase client and builds one query (never sent).
import { readFileSync } from "node:fs";

for (const name of Object.keys(process.env)) {
  if (name.includes("SUPABASE")) delete process.env[name];
}
const declared = readFileSync(new URL("./env.example", import.meta.url), "utf8")
  .split("\n")
  .filter((line) => /^[A-Z_]+=/.test(line))
  .map((line) => line.split("=")[0]);

const url = "https://qhzkvtmnwplxbrsejdfa.supabase.co";
const values = { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_test_flight_offline" };
for (const name of declared) process.env[name] = values[name];

try {
  const { maydays } = await import("./lib/supabase.mjs");
  const query = maydays();
  const target = String(query.url);
  if (!target.startsWith(`${url}/rest/v1/maydays`)) {
    throw new Error(`Client points at ${target}, expected ${url}/rest/v1/maydays`);
  }
} catch (err) {
  console.error(err);
  console.error("\nFAIL: the Supabase client could not be created from the project's environment.");
  process.exit(1);
}

console.log("PASS: Supabase client created from the project's environment.");
