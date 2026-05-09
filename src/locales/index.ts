import en, { type TranslationKey } from "./en"
import zh from "./zh"

export type { TranslationKey }
export type SupportedLocale = "en" | "zh"
export type LocaleMessages = Record<TranslationKey, string>

type LocaleMap = Record<SupportedLocale, LocaleMessages>
export const locales: LocaleMap = {
  en,
  zh,
}
