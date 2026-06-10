import { type SupportedLocale, type TranslationKey, locales } from "../locales"

let currentLang: SupportedLocale = "en"
let fallbackLang: SupportedLocale = "en"

function isSupportedLocale(locale: string): locale is SupportedLocale {
  return locale in locales
}

function isTranslationKey(key: string): key is TranslationKey {
  return key in locales.en
}

function detectLocale(): SupportedLocale {
  const envLang = process.env.LANG ?? ""
  const lang = envLang.split(".")[0]?.split("_")[0]?.toLowerCase() ?? "en"
  const supported: Record<string, SupportedLocale> = { zh: "zh", ru: "ru" }
  return supported[lang] ?? "en"
}

export function initI18n(opts?: { locale?: string; fallback?: string }): void {
  currentLang = opts?.locale && isSupportedLocale(opts.locale)
    ? opts.locale
    : detectLocale()
  fallbackLang = opts?.fallback && isSupportedLocale(opts.fallback)
    ? opts.fallback
    : "en"
  if (!isSupportedLocale(currentLang)) currentLang = "en"
}

export function getLocale(): SupportedLocale {
  return currentLang
}

export function setLocale(lang: string): void {
  if (isSupportedLocale(lang)) currentLang = lang
}

export function t(key: TranslationKey, params?: Record<string, string | number>): string
export function t(key: string, params?: Record<string, string | number>): string
export function t(key: string, params?: Record<string, string | number>): string {
  let msg = key
  if (isTranslationKey(key)) {
    msg = locales[currentLang][key] ?? locales[fallbackLang][key] ?? key
  }
  if (!params) return msg
  return msg.replace(/\{\{(\w+)\}\}/g, (_match: string, name: string) => {
    const value = params[name]
    return value != null ? String(value) : `{{${name}}}`
  })
}
