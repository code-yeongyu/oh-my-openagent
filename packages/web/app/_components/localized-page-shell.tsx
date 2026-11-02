import type { JSX } from "react"
import { NextIntlClientProvider } from "next-intl"
import { getTranslations } from "next-intl/server"
import { Footer } from "@/components/footer"
import { NavHeader } from "@/components/nav-header"
import type { Locale } from "@/i18n/config"
import { FALLBACK_FORMATTED_STATS, formatStats, getStats } from "@/lib/stats"

type LocalizedPageShellProps = {
  children: React.ReactNode
  locale: Locale
}

type IntlMessages = Record<string, Record<string, unknown>>

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
  const t = await getTranslations({ locale, namespace: "nav" })
  const stars = await getStarsLabel()

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <div data-locale={locale} className="flex min-h-dvh flex-col">
        <a href="#main-content" className="skip-link focus-ring">
          {t("skipToContent")}
        </a>
        <NavHeader stars={stars} />
        <main id="main-content" tabIndex={-1} className="flex-1">
          {children}
        </main>
        <Footer locale={locale} />
      </div>
    </NextIntlClientProvider>
  )
}
