export const locales = ["en", "ko", "ja", "zh", "es", "fr", "de", "pt-BR", "it"] as const

export const localeNames: Readonly<Record<(typeof locales)[number], string>> = {
  en: "English",
  ko: "한국어",
  ja: "日本語",
  zh: "简体中文",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  "pt-BR": "Português (Brasil)",
  it: "Italiano",
}

export type Locale = (typeof locales)[number]

export const defaultLocale: Locale = "en"
