export const locales = ["en", "ko", "ja", "zh", "ru"] as const

export type Locale = (typeof locales)[number]

export const defaultLocale: Locale = "en"
