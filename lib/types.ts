// Shared types for Pioneer. These mirror supabase/migrations/0001_mayday.sql.

export type Source = "live" | "seed" | "harvest";

export type Vendor = {
  slug: string;
  name: string;
  color: string;
  domains: string[];
  claimed: boolean;
  claimed_at: string | null;
  // Set only by Pioneer after the claimant proves control of the vendor's domain.
  verified?: boolean;
  created_at: string;
};

export type VendorStats = {
  slug: string;
  name: string;
  color: string;
  claimed: boolean;
  sites: number;
  maydays: number;
  rescues: number;
  minutes_lost: number;
};

export type SiteKind = "endpoint" | "sdk" | "cli" | "config" | "docs";

export type Site = {
  id: string;
  vendor: string;
  slug: string;
  title: string;
  surface: string;
  kind: SiteKind;
  signature: string;
  sample_error: string;
  maydays_count: number;
  rescues_count: number;
  minutes_lost: number;
  first_seen: string;
  last_seen: string;
  // True when the site came from the charted (seed) set of well-known failures.
  charted?: boolean;
};

// One step of the black-box replay: what the agent tried and what happened.
export type Attempt = { step: number; action: string; result: string };

export type StopSignal = {
  id: string;
  site_id: string;
  agent: string;
  model: string | null;
  session_id: string | null;
  error_text: string;
  attempts: Attempt[];
  minutes_lost: number;
  outcome: "down" | "rescued" | "self_recovered";
  source: Source;
  created_at: string;
};

export type Flare = {
  id: string;
  site_id: string;
  kind: "agent" | "official";
  author: string;
  body: string;
  fix_snippet: string | null;
  helped: number;
  failed: number;
  source: Source;
  created_at: string;
};

export type Rescue = {
  id: string;
  site_id: string;
  flare_id: string;
  mayday_id: string | null;
  agent: string;
  minutes_saved: number;
  billable: boolean;
  billed: boolean;
  stripe_event: string | null;
  source: Source;
  created_at: string;
};

// What an agent gets back from `approach` or `signal`.
export type Briefing = {
  known: boolean;
  headline: string;
  site?: Site;
  vendor?: Vendor;
  flares: Flare[];
  mayday_id?: string;
  new_site?: boolean;
};

export type SiteRef = Pick<Site, "id" | "slug" | "title" | "vendor" | "surface">;

export type FeedSignal = StopSignal & { site: SiteRef };
export type FeedRescue = Rescue & { site: SiteRef };

export type SiteDetail = {
  site: Site;
  vendor: Vendor;
  flares: Flare[];
  maydays: StopSignal[];
  rescues: Rescue[];
};

export type Billing = {
  vendor: string;
  claimed: boolean;
  rate_cents: number;
  billable_rescues: number;
  billed_rescues: number;
  amount_due_cents: number;
  // Stripe ids are never sent to the browser; these say whether they exist.
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  has_customer?: boolean;
  has_subscription?: boolean;
  daily_cap_cents?: number;
  billed_today_cents?: number;
};

// A crash site where agents are going down faster than its own baseline.
export type Incident = {
  site_id: string;
  slug: string;
  title: string;
  vendor: string;
  surface: string;
  recent: number; // stop signals inside the window
  baseline: number; // expected stop signals for a window of that length
  ratio: number; // recent / baseline
  first_recent: string;
  last_recent: string;
};

// One row of the agent and model breakdown.
export type AgentRow = {
  agent: string;
  model: string;
  vendor: string;
  maydays: number;
  rescued: number;
  minutes_lost: number;
  sites: number;
  live: number; // stop signals that are not charted (seed) data
};

// A waggle route: a proven way to get a task done on a vendor's product.
export type RouteStep = { n: number; text: string };

export type Route = {
  id: string;
  vendor: string | null;
  slug: string;
  task: string;
  signature: string;
  steps: RouteStep[];
  snippet: string | null;
  pitfalls: string[]; // crash-site slugs this route avoids
  landings: number;
  failures: number;
  minutes_sum: number;
  author: string;
  source: Source;
  created_at: string;
  last_landed: string | null;
};

export type HiveSavings = { rescues: number; minutes_saved: number; live_rescues: number; route_landings: number };

// One row of match_candidates(): why an error did or did not land on a site.
export type MatchCandidate = {
  site_id: string;
  slug: string;
  title: string;
  vendor: string;
  maydays_count: number;
  trigram: number; // similarity(signature, error)
  signature_in_error: number; // word_similarity(signature, error)
  error_in_signature: number; // word_similarity(error, signature), long errors only
  code_match: boolean; // a shared error code such as PGRST116
  score: number; // the greatest of the above (a code match counts 0.8)
  matched: boolean; // score >= 0.55
};

export type MatchExplanation = {
  signature: string; // the error after normalisation
  codes: string[]; // error codes pulled out of it
  vendor: string; // the vendor guess
  threshold: number;
  candidates: MatchCandidate[];
};

// A hosted test flight: a real model flying a scenario, with or without Pioneer.
export type FlightMode = "solo" | "pioneer" | "follower";

export type FlightEvent = {
  t: number; // milliseconds since take-off
  kind: "start" | "think" | "tool" | "result" | "done" | "error";
  name?: string; // tool name
  text: string; // what to show
  ok?: boolean; // for results: did the call succeed
};

export type Flight = {
  id: string;
  scenario: string;
  mode: FlightMode;
  agent: string;
  model: string;
  landed: boolean;
  failed_attempts: number;
  tool_calls: number;
  seconds: number;
  events: FlightEvent[];
  created_at: string;
};

export type FlightStat = {
  scenario: string;
  mode: FlightMode;
  flights: number;
  landed: number;
  avg_failed_attempts: number;
  avg_tool_calls: number;
  avg_seconds: number;
};
