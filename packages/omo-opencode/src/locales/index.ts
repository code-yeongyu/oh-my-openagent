import en, { type TranslationKey } from "./en"
import ko from "./ko"
import zh from "./zh"

export type { TranslationKey }
export type SupportedLocale = "en" | "zh" | "ko"
export type LocaleMessages = Record<TranslationKey, string>

type LocaleMap = Record<SupportedLocale, LocaleMessages>
export const locales: LocaleMap = {
  en,
  zh,
  ko,
}
