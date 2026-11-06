import { getRequestConfig } from "next-intl/server"
import type { Locale } from "./config"
import { routing } from "./routing"

type Messages = Record<string, unknown>

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale
  const locale: Locale =
    requested && routing.locales.includes(requested as Locale)
      ? (requested as Locale)
      : routing.defaultLocale

  const messages = (await import(`../messages/${locale}.json`)).default as Messages
  // The home page copy is written in English first; a locale without its own `home` namespace shows English until
  // it is translated, instead of a page of missing-message keys.
  if (locale !== routing.defaultLocale && !("home" in messages)) {
    const fallback = (await import("../messages/en.json")).default as Messages
    return { locale, messages: { ...messages, home: fallback.home } }
  }
  return { locale, messages }
})
