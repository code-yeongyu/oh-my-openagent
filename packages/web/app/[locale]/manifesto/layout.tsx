import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Ultrawork Manifesto",
  description:
    "The philosophy of high-output engineering. Why human developers should be architects, not spell-checkers.",
}

export default function ManifestoLayout({ children }: { children: React.ReactNode }) {
  return children
}
