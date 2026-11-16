import type { Metadata } from "next"
import type { JSX, ReactNode } from "react"
import { notFound } from "next/navigation"
import { hasLocale } from "next-intl"
import { setRequestLocale } from "next-intl/server"
import { DocumentShell } from "@/app/_components/document-shell"
import { LocalizedPageShell } from "@/app/_components/localized-page-shell"
import { generateSiteMetadata, siteViewport } from "@/app/_components/site-metadata"
import { languageTag } from "@/i18n/config"
import { routing } from "@/i18n/routing"

export const revalidate = 3600
// No `dynamicParams = false` here: on this root segment it would close every route below it, and on Cloudflare
// (empty incremental cache) each cache miss would 404. Unknown locales 404 through notFound() below, which renders
// Next's built-in 404 shell; app/global-not-found.tsx is not reached while [locale] matches every URL (#11528).
export const viewport = siteViewport

export function generateMetadata(): Promise<Metadata> {
  return generateSiteMetadata()
}

export function generateStaticParams(): Array<{ readonly locale: string }> {
  return routing.locales.map((locale) => ({ locale }))
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}): Promise<JSX.Element> {
  const { locale } = await params

  if (!hasLocale(routing.locales, locale)) {
    notFound()
  }

  setRequestLocale(locale)

  return (
    <DocumentShell lang={languageTag(locale)}>
      <LocalizedPageShell locale={locale}>{children}</LocalizedPageShell>
    </DocumentShell>
  )
}
