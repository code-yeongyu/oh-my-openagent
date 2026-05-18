import type { Metadata } from "next"
import type { JSX } from "react"
import { notFound } from "next/navigation"
import { hasLocale } from "next-intl"
import { setRequestLocale } from "next-intl/server"
import { LocalizedPageShell } from "@/app/_components/localized-page-shell"
import { routing } from "@/i18n/routing"

export const metadata: Metadata = {
  description:
    "Meet Sisyphus: The batteries-included agent that codes like you. Multi-model orchestration, background agents, 40+ lifecycle hooks.",
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}): Promise<JSX.Element> {
  const { locale } = await params

  if (!hasLocale(routing.locales, locale)) {
    notFound()
  }

  setRequestLocale(locale)

  return <LocalizedPageShell locale={locale}>{children}</LocalizedPageShell>
}
