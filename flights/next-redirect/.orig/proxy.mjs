import { NextResponse } from "next/server.js";

// Sends signed-out visitors to the login page and remembers where they were going.
export function proxy(request) {
  const session = request.cookies.get("session");
  const { pathname } = request.nextUrl;

  if (!session && pathname.startsWith("/dashboard")) {
    return NextResponse.redirect(`/login?from=${encodeURIComponent(pathname)}`);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/dashboard/:path*"] };
