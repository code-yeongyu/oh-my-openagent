export { generateHomeMetadata as generateMetadata } from "@/components/home/home-page"

import type { JSX } from "react"
import { setRequestLocale } from "next-intl/server"

import { HomePage } from "@/components/home/home-page"

export default async function LocaleHomePage({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<JSX.Element> {
  const { locale } = await params
  setRequestLocale(locale)
  return <HomePage />
}
