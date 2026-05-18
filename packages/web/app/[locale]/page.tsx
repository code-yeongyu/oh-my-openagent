export { landingMetadata as metadata } from "@/app/_components/landing-page"

import type { JSX } from "react"
import { setRequestLocale } from "next-intl/server"
import { LandingPage } from "@/app/_components/landing-page"

export default async function LocaleLandingPage({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<JSX.Element> {
  const { locale } = await params

  setRequestLocale(locale)

  return <LandingPage />
}
