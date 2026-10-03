// One-tap examples for the matching page. Kept in a plain module (no
// "use client") so the server shell can read the default too.

export type MatchExample = { id: string; label: string; error: string };

export const EXAMPLES: MatchExample[] = [
  {
    id: "exact",
    label: "Exact charted error",
    error: '{"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \\"profiles\\""}',
  },
  {
    id: "reworded",
    label: "Same failure, different words",
    error:
      'Error: insert failed (42501): new row violates row-level security policy for table "invoices"\n    at saveInvoice (/app/lib/db.ts:41:11)',
  },
  { id: "code", label: "Bare error code", error: "PGRST116" },
  {
    id: "hivepay",
    label: "HivePay error",
    error: "HivePayError [HP_AMOUNT_MINOR_UNITS]: amount must be an integer number of minor units",
  },
  { id: "unrelated", label: "Unrelated error", error: "TypeError: Cannot read properties of undefined (reading 'map')" },
];

// What the textarea holds when nobody deep-linked an error: the reworded one,
// because it shows why a single trigram score is not enough.
export const DEFAULT_ERROR = EXAMPLES[1].error;
