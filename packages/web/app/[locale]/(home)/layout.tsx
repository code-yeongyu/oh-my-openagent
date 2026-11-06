import type { Metadata } from "next"
import type { JSX, ReactNode } from "react"
import { notFound } from "next/navigation"
import { hasLocale, NextIntlClientProvider } from "next-intl"
import { setRequestLocale } from "next-intl/server"

import { HomeDocument } from "@/components/home/home-document"
import { generateSiteMetadata, homeViewport } from "@/app/_components/site-metadata"
import { languageTag } from "@/i18n/config"
import { routing } from "@/i18n/routing"

export const revalidate = 3600
export const viewport = homeViewport

export function generateMetadata(): Promise<Metadata> {
  return generateSiteMetadata()
}

export function generateStaticParams(): Array<{ readonly locale: string }> {
  return routing.locales.map((locale) => ({ locale }))
}

/**
 * The home page's own root layout: it ships the doriterm-family stylesheet (`components/home/styles`) and fonts
 * and none of the docs site's Tailwind layer, so the first paint carries only what this page draws. Moving between
 * the home page and the docs is a full navigation, as it is between two root layouts.
 */
export default async function HomeLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}): Promise<JSX.Element> {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) notFound()
  setRequestLocale(locale)

  return (
    <HomeDocument
      lang={languageTag(locale)}
      cjk={locale === "ko" || locale === "ja" || locale === "zh"}
    >
      <NextIntlClientProvider locale={locale}>{children}</NextIntlClientProvider>
    </HomeDocument>
  )
}
