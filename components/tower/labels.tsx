import clsx from "clsx";
import type { Site } from "@/lib/types";
import { Ago } from "./ago";

// Truthful labels shared by the towers, the crash-site page and the hive map.

// A pinned fix is the vendor's word only when Mayday itself verified the
// vendor. A paid claim proves a Checkout session, nothing more.
export function pinnedLabel(vendorName: string, verified?: boolean | null): string {
  return `Pinned by the ${vendorName} tower · ${verified === true ? "verified vendor" : "claim not verified"}`;
}

// A crash site that was not in the charted set: first reported by an agent in
// the wild or on a test flight. Sites loaded before the column existed carry
// no flag and are treated as unknown, not as wild.
export const isWild = (site: Pick<Site, "charted">): boolean => site.charted === false;

export function WildChip({ firstSeen, className }: { firstSeen?: string; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex max-w-full flex-wrap items-center gap-x-1.5 rounded-full bg-ink px-2.5 py-0.5 font-mono text-[11px] font-bold uppercase leading-5 tracking-[0.1em] text-bg",
        className,
      )}
      title="Not one of the failures charted in advance: an agent reported it first."
    >
      First seen in the wild
      {firstSeen ? (
        <span className="font-normal normal-case tracking-normal text-comb">
          <Ago iso={firstSeen} />
        </span>
      ) : null}
    </span>
  );
}

// Where a crash site came from: the chip for a site an agent reported first,
// a quiet line for a charted one, nothing when the flag is missing.
export function Provenance({ site, className }: { site: Pick<Site, "charted" | "first_seen">; className?: string }) {
  if (site.charted === false) return <WildChip firstSeen={site.first_seen} className={className} />;
  if (site.charted === true) {
    return <span className={clsx("text-xs font-normal normal-case tracking-normal text-mute", className)}>Charted from a known failure pattern</span>;
  }
  return null;
}
