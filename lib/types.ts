// Shared types for Mayday. These mirror supabase/migrations/0001_mayday.sql.

export type Source = "live" | "seed" | "harvest";

export type Vendor = {
  slug: string;
  name: string;
  color: string;
  domains: string[];
  claimed: boolean;
  claimed_at: string | null;
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
};

// One step of the black-box replay: what the agent tried and what happened.
export type Attempt = { step: number; action: string; result: string };

export type Mayday = {
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

// What an agent gets back from `approach` or `mayday`.
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

export type FeedMayday = Mayday & { site: SiteRef };
export type FeedRescue = Rescue & { site: SiteRef };

export type SiteDetail = {
  site: Site;
  vendor: Vendor;
  flares: Flare[];
  maydays: Mayday[];
  rescues: Rescue[];
};

export type Billing = {
  vendor: string;
  claimed: boolean;
  rate_cents: number;
  billable_rescues: number;
  billed_rescues: number;
  amount_due_cents: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
};

// A crash site where agents are going down faster than its own baseline.
export type Incident = {
  site_id: string;
  slug: string;
  title: string;
  vendor: string;
  surface: string;
  recent: number; // maydays inside the window
  baseline: number; // expected maydays for a window of that length
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
  live: number; // maydays that are not charted (seed) data
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
