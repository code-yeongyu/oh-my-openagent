import en, { type TranslationKey } from "./en"
import zh from "./zh"
import ru from "./ru"

export type { TranslationKey }
export type SupportedLocale = "en" | "zh" | "ru"
export type LocaleMessages = Record<TranslationKey, string>

type LocaleMap = Record<SupportedLocale, LocaleMessages>
export const locales: LocaleMap = {
  en,
  zh,
  ru,
}
