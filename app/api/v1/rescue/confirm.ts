import "server-only";
import { recordRescue, type RescueInput } from "@/lib/data";
import { billRescue } from "@/lib/stripe";
import type { Rescue } from "@/lib/types";

export type ConfirmedRescue = {
  rescue: Rescue;
  vendor: string;
  billable: boolean;
  billed: boolean;
  stripe_event?: string;
  billing_note?: string;
};

// Records a rescue and, when it used an official fix in claimed airspace,
// meters it to the vendor. Shared by POST /api/v1/rescue and the MCP tool.
// A billing failure never fails the rescue.
export async function confirmRescue(input: RescueInput): Promise<ConfirmedRescue> {
  const result = await recordRescue(input);
  if (!result.billable) return { ...result, billed: false };

  let bill: Awaited<ReturnType<typeof billRescue>>;
  try {
    bill = await billRescue(result.rescue.id, result.vendor);
  } catch (e) {
    bill = { billed: false, reason: e instanceof Error ? e.message : "billing failed" };
  }

  const stripe_event = bill.stripe_event ?? undefined;
  return {
    rescue: { ...result.rescue, billed: bill.billed, stripe_event: stripe_event ?? result.rescue.stripe_event },
    vendor: result.vendor,
    billable: true,
    billed: bill.billed,
    ...(stripe_event ? { stripe_event } : {}),
    ...(!bill.billed && bill.reason ? { billing_note: bill.reason } : {}),
  };
}
