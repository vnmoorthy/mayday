import { SCENARIOS, type Scenario } from "@/components/cockpit/scenarios";

// The flights an audience member can take from /join. Each one is a cockpit
// scenario, so the error text is exactly what the product emits. HivePay comes
// first: it is a fictional vendor, so its rule is in no model's training data.
// There is no free text anywhere in audience mode: a bee picks a preset and
// nothing else.

export type Preset = {
  product: string;
  cta: string;
  // One line of the real error, short enough for a phone.
  gist: string;
  // The flight shown first and largest.
  featured: boolean;
  scenario: Scenario;
};

const PICKS: { id: string; product: string; cta: string; gist: string; featured?: boolean }[] = [
  {
    id: "hivepay-minor-units",
    product: "HivePay",
    cta: "Fly into HivePay, the API no model has seen",
    gist: "HP_AMOUNT_MINOR_UNITS: amount must be an integer number of minor units",
    featured: true,
  },
  {
    id: "stripe-webhook-raw-body",
    product: "Stripe",
    cta: "Fly into a Stripe webhook",
    gist: "No signatures found matching the expected signature for payload",
  },
  {
    id: "supabase-rls-insert",
    product: "Supabase",
    cta: "Fly into a Supabase RLS wall",
    gist: "42501: new row violates row-level security policy",
  },
  {
    id: "vercel-params-awaited",
    product: "Vercel",
    cta: "Fly into a Next.js route",
    gist: "`params` should be awaited before using its properties",
  },
  {
    id: "anthropic-tool-use-without-result",
    product: "Anthropic",
    cta: "Fly into a Claude tool call",
    gist: "`tool_use` ids were found without `tool_result` blocks",
  },
];

export const PRESETS: Preset[] = PICKS.flatMap((p) => {
  const scenario = SCENARIOS.find((s) => s.id === p.id);
  return scenario ? [{ product: p.product, cta: p.cta, gist: p.gist, featured: p.featured === true, scenario }] : [];
});

// Audience bees are named bee-xxxx. The big screen prints only names of this
// shape, so nothing typed into the public API by hand reaches the projector.
export const BEE_NAME = /^bee-[a-z0-9]{4}$/;

export const JOIN_URL = "https://pioneer-hive.vercel.app/join";
export const JOIN_URL_SHORT = "pioneer-hive.vercel.app/join";
