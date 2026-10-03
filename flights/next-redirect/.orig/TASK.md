# Next.js proxy crashes when it redirects to the login page

`proxy.mjs` is the Next.js proxy (the file that used to be called middleware).
It should send signed-out visitors who open `/dashboard` to
`/login?from=<the path they wanted>` and let everyone else through. Right now
it throws as soon as a signed-out visitor arrives.

Make `node check.mjs` pass.

Rules:

- Do not change `check.mjs`.
- Keep using `NextResponse` from `next/server`.
- Everything runs offline with a plain `node` script. No dev server is needed.
