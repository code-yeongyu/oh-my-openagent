const LOCALE_TIMEZONE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["en-US", "America/New_York"],
  ["en-GB", "Europe/London"],
  ["en-CA", "America/Toronto"],
  ["en-AU", "Australia/Sydney"],
  ["it-IT", "Europe/Rome"],
  ["fr-FR", "Europe/Paris"],
  ["de-DE", "Europe/Berlin"],
  ["es-ES", "Europe/Madrid"],
  ["pt-BR", "America/Sao_Paulo"],
  ["pt-PT", "Europe/Lisbon"],
  ["ja-JP", "Asia/Tokyo"],
  ["zh-CN", "Asia/Shanghai"],
  ["ko-KR", "Asia/Seoul"],
  ["hi-IN", "Asia/Kolkata"],
  ["ru-RU", "Europe/Moscow"],
  ["ar-SA", "Asia/Riyadh"],
  ["nl-NL", "Europe/Amsterdam"],
  ["pl-PL", "Europe/Warsaw"],
  ["tr-TR", "Europe/Istanbul"],
  ["sv-SE", "Europe/Stockholm"],
]

const LOCALE_TO_TIMEZONE = new Map(LOCALE_TIMEZONE_PAIRS)
const TIMEZONE_TO_LOCALE = new Map(LOCALE_TIMEZONE_PAIRS.map(([locale, tz]) => [tz, locale]))

export function localeToTimezone(locale: string): string | undefined {
  return LOCALE_TO_TIMEZONE.get(locale)
}

export function timezoneToLocale(timezone: string): string | undefined {
  return TIMEZONE_TO_LOCALE.get(timezone)
}

export function getKnownLocales(): readonly string[] {
  return LOCALE_TIMEZONE_PAIRS.map(([locale]) => locale)
}
