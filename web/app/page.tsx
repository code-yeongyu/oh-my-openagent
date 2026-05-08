export { landingMetadata as metadata } from "@/app/_components/landing-page"

import type { JSX } from "react"
import { setRequestLocale } from "next-intl/server"
import { LandingPage } from "@/app/_components/landing-page"
import { LocalizedPageShell } from "@/app/_components/localized-page-shell"
import { defaultLocale } from "@/i18n/config"

export default function HomePage(): JSX.Element {
  setRequestLocale(defaultLocale)

  return (
    <LocalizedPageShell locale={defaultLocale}>
      <LandingPage />
    </LocalizedPageShell>
  )
}
