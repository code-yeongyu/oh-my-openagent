import type { JSX } from "react"
import { NextIntlClientProvider } from "next-intl"
import { Footer } from "@/components/footer"
import { NavHeader } from "@/components/nav-header"
import type { Locale } from "@/i18n/config"
import { FALLBACK_FORMATTED_STATS, formatStats, getStats } from "@/lib/stats"

type LocalizedPageShellProps = {
  children: React.ReactNode
  locale: Locale
}

type IntlMessages = Record<string, Record<string, unknown>>

function getLanguageTag(locale: Locale): string {
  switch (locale) {
    case "zh":
      return "zh-CN"
    default:
      return locale
  }
}

async function getStarsLabel(): Promise<string> {
  try {
    return formatStats(await getStats()).stars
  } catch (error) {
    console.warn("Unable to load GitHub stars for the nav; using fallback", error)
    return FALLBACK_FORMATTED_STATS.stars
  }
}

export async function LocalizedPageShell({
  children,
  locale,
}: LocalizedPageShellProps): Promise<JSX.Element> {
  const messages = (await import(`../../messages/${locale}.json`)).default as IntlMessages
  const languageTag = getLanguageTag(locale)
  const stars = await getStarsLabel()

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <div lang={languageTag} data-locale={locale} className="flex min-h-screen flex-col">
        <NavHeader stars={stars} />
        <main className="flex-1">{children}</main>
        <Footer locale={locale} />
      </div>
    </NextIntlClientProvider>
  )
}
