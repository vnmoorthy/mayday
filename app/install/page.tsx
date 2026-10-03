import type { Metadata } from "next";
import { InstallGuide } from "@/components/cockpit/install-guide";

export const metadata: Metadata = {
  title: "Install · Pioneer",
  description: "Connect an agent to Pioneer over MCP, with the Claude Code plugin, or with plain HTTP.",
};

// Static copy; the snippets fill in the origin on the client.
export default function InstallPage() {
  return <InstallGuide />;
}
