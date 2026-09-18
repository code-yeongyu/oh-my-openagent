import { type SupportedLocale, type TranslationKey } from "../locales";
export declare function initI18n(opts?: {
    locale?: string;
    fallback?: string;
}): void;
export declare function getLocale(): SupportedLocale;
export declare function setLocale(lang: string): void;
export declare function t(key: TranslationKey, params?: Record<string, string | number>): string;
export declare function t(key: string, params?: Record<string, string | number>): string;
