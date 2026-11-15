import type { JSX } from "react"
import { Frame } from "@/components/ledger/frame"
import { ManifestoChapters } from "@/components/manifesto/reading/chapters"
import { ManifestoClosing } from "@/components/manifesto/reading/closing"
import { ManifestoHeader } from "@/components/manifesto/reading/header"

export default async function ManifestoPage(): Promise<JSX.Element> {
  return (
    <Frame as="div" className="bg-ink-0 text-text-hi">
      <ManifestoHeader />
      <ManifestoChapters />
      <ManifestoClosing />
    </Frame>
  )
}
