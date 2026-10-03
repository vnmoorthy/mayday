import type { Metadata } from "next";
import { InstallGuide } from "@/components/cockpit/install-guide";

export const metadata: Metadata = {
  title: "Install · Mayday",
  description: "Connect an agent to Mayday over MCP, with the Claude Code plugin, or with plain HTTP.",
};

// Static copy; the snippets fill in the origin on the client.
export default function InstallPage() {
  return <InstallGuide />;
}
