// Runs the proxy against a signed-out and a signed-in request.
import { NextRequest } from "next/server.js";
import { proxy } from "./proxy.mjs";

const url = "https://app.example.com/dashboard/settings";

try {
  const res = proxy(new NextRequest(url));
  const location = res.headers.get("location");
  const want = "https://app.example.com/login?from=%2Fdashboard%2Fsettings";
  if (res.status !== 307 || location !== want) {
    throw new Error(`Expected a 307 redirect to ${want}, got status ${res.status} and location ${location}`);
  }
} catch (err) {
  console.error(err);
  console.error("\nFAIL: a signed-out visitor was not redirected to the login page.");
  process.exit(1);
}

const signedIn = proxy(new NextRequest(url, { headers: { cookie: "session=abc123" } }));
if (signedIn.headers.get("x-middleware-next") !== "1") {
  console.error("FAIL: a signed-in visitor must be let through with NextResponse.next().");
  process.exit(1);
}

console.log("PASS: signed-out visitors are redirected, signed-in visitors pass through.");
