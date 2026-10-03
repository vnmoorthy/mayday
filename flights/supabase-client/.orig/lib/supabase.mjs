import { createClient } from "@supabase/supabase-js";

// One shared client for the whole app.
export const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

export const maydays = () => supabase.from("maydays").select("id, created_at");
