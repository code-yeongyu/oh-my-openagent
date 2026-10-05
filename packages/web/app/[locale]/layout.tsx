import type { Metadata } from "next"
import type { JSX, ReactNode } from "react"
import { notFound } from "next/navigation"
import { hasLocale } from "next-intl"
import { setRequestLocale } from "next-intl/server"
import { LocalizedPageShell } from "@/app/_components/localized-page-shell"
import { routing } from "@/i18n/routing"
import { getStats, FALLBACK_DESCRIPTION } from "@/lib/stats"

export async function generateMetadata(): Promise<Metadata> {
  let description = FALLBACK_DESCRIPTION
  try {
    description = (await getStats()).description
  } catch (error) {
    console.warn("Unable to refresh localized metadata; using fallback description", error)
  }

  return { description }
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

  return <LocalizedPageShell locale={locale}>{children}</LocalizedPageShell>
}
