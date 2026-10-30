import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Ultrawork Manifesto (January 2026)",
  description:
    "The archived January 2026 manifesto: why human intervention is a failure signal and agent-written code should be indistinguishable from a senior engineer's.",
}

export default function LegacyManifestoLayout({ children }: { children: React.ReactNode }) {
  return children
}
