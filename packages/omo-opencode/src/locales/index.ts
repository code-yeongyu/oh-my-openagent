import en, { type TranslationKey } from "./en"
import fr from "./fr"
import zh from "./zh"

export type { TranslationKey }
export type SupportedLocale = "en" | "fr" | "zh"
export type LocaleMessages = Record<TranslationKey, string>

type LocaleMap = Record<SupportedLocale, LocaleMessages>
export const locales: LocaleMap = {
  en,
  fr,
  zh,
}
