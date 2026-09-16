import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Ultrawork Manifesto",
  description:
    "Our thinking behind the tools we build for today and tomorrow, so you can stay on your work.",
}

export default function ManifestoLayout({ children }: { children: React.ReactNode }) {
  return children
}
