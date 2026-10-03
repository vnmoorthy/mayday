import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { NotConnected } from "@/components/tower/parts";
import { getOfficialFixSiteIds } from "@/components/tower/server";
import { TowerClient } from "@/components/tower/tower-client";
import type { Rating } from "@/lib/airworthiness";
import { getRating, getSites, getVendor } from "@/lib/data";
import type { Site, Vendor } from "@/lib/types";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ vendor: string }>;
  searchParams: Promise<{ claimed?: string | string[] }>;
};

// A stray "%" in the path must give a 404, not a crash.
function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

// The origin the visitor is on, so the README snippet points at this
// deployment and renders the same on the server and in the browser.
async function pageOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host);
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() || (local ? "http" : "https");
  return `${proto}://${host}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { vendor } = await params;
  return { title: `${decode(vendor)} tower — Mayday` };
}

export default async function TowerPage({ params, searchParams }: Props) {
  const [{ vendor: raw }, query] = await Promise.all([params, searchParams]);
  const slug = decode(raw);

  let vendor: Vendor | null;
  let sites: Site[] = [];
  let official: string[] = [];
  let rating: Rating | null = null;
  try {
    vendor = await getVendor(slug);
    if (vendor) {
      [sites, official, rating] = await Promise.all([getSites(slug), getOfficialFixSiteIds(slug), getRating(slug)]);
    }
  } catch (e) {
    return <NotConnected message={e instanceof Error ? e.message : "Unknown error"} />;
  }
  if (!vendor) notFound();

  // Only announce the claim when the vendor really is claimed: the query
  // string alone proves nothing.
  const justClaimed = query.claimed === "1" && vendor.claimed;

  return (
    <TowerClient
      key={vendor.slug}
      vendor={vendor}
      sites={sites}
      officialSiteIds={official}
      rating={rating}
      origin={await pageOrigin()}
      justClaimed={justClaimed}
    />
  );
}
