# Supabase client fails to start: supabaseUrl is required

`lib/supabase.mjs` creates the Supabase client for our Next.js app. The
project's environment variables are listed in `env.example`; in development
Next.js loads them from `.env.local`. The app crashes on startup before it
makes a single query.

Make `node check.mjs` pass.

Rules:

- Do not change `check.mjs` or `env.example`.
- Do not hardcode the project URL or key in the source.
- Everything runs offline. No Supabase project or network access is needed.
