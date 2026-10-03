import type { Metadata } from "next";
import { Demo } from "@/components/demo/demo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Product demo — Pioneer",
  description: "One agent fails on an API no model has seen. The hive is notified. The next agent is warned and lands.",
};

// The shell only frames the page; the whole sequence runs in the client
// component against the live API (reset, pioneer flight, follower flight).
export default function DemoPage() {
  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 sm:px-6">
      <Demo />
    </div>
  );
}
