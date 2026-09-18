import { type TranslationKey } from "./en";
export type { TranslationKey };
export type SupportedLocale = "en" | "zh";
export type LocaleMessages = Record<TranslationKey, string>;
type LocaleMap = Record<SupportedLocale, LocaleMessages>;
export declare const locales: LocaleMap;
