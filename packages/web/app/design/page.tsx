import type { Metadata } from "next"
import type { JSX } from "react"
import { notFound } from "next/navigation"
import { setRequestLocale } from "next-intl/server"

import { LocalizedPageShell } from "@/app/_components/localized-page-shell"
import { Eyebrow } from "@/components/ledger/eyebrow"
import { Frame } from "@/components/ledger/frame"
import { defaultLocale } from "@/i18n/config"

import { ControlsShowcase } from "./_showcase/controls"
import { LedgerShowcase } from "./_showcase/ledger"

/**
 * Primitive showcase (DESIGN.md §5, §13). Gated on OMO_WEB_SHOWCASE=1 rather than NODE_ENV
 * so it can be screenshotted against `next start`; read per request so the flag is honoured
 * at runtime. Not localized, not in the sitemap, disallowed in robots while enabled.
 */
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Design primitives",
  robots: { index: false, follow: false },
}

export default function DesignPage(): JSX.Element {
  if (process.env.OMO_WEB_SHOWCASE !== "1") {
    notFound()
  }

  setRequestLocale(defaultLocale)

  return (
    <LocalizedPageShell locale={defaultLocale}>
      <Frame as="section" aria-labelledby="design-title" className="py-16 lg:py-24">
        <Eyebrow rule dot="accent">
          Phosphor Ledger · primitives
        </Eyebrow>
        <h1
          id="design-title"
          className="text-text-hi mt-4 max-w-4xl text-[clamp(2.5rem,1.35rem+4.4vw,5.25rem)] leading-[0.98] font-medium tracking-[-0.03em] text-balance"
        >
          Every primitive, every state.
        </h1>
        <p className="text-text-mid mt-6 max-w-2xl text-lg leading-[1.6] md:text-xl">
          The nav above is live: scroll past 24px for the scrolled state, narrow the viewport for
          the sheet. Everything below traces to DESIGN.md §2–§7.
        </p>
      </Frame>
      <Frame>
        <ControlsShowcase />
        <LedgerShowcase />
      </Frame>
    </LocalizedPageShell>
  )
}
