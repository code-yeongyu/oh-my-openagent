import type { AgentConfig } from "@opencode-ai/sdk"

const LOCALE_LANGUAGE_LABELS: Record<string, string> = {
  zh: "Simplified Chinese",
  ja: "Japanese",
  ko: "Korean",
  es: "Spanish",
  fr: "French",
  de: "German",
  ru: "Russian",
  "pt-br": "Brazilian Portuguese",
  pt: "Portuguese",
  it: "Italian",
  tr: "Turkish",
  pl: "Polish",
  ar: "Arabic",
  th: "Thai",
}

function normalizeLocale(input: string): string {
  return input.trim().replace(/_/g, "-").toLowerCase()
}

function detectSystemLocale(): string | undefined {
  const candidates = [
    process.env.LC_ALL,
    process.env.LC_MESSAGES,
    process.env.LANG,
    Intl.DateTimeFormat().resolvedOptions().locale,
  ]

  for (const candidate of candidates) {
    if (!candidate) continue
    const normalized = normalizeLocale(candidate)
    if (normalized && normalized !== "c" && normalized !== "posix") {
      return normalized
    }
  }

  return undefined
}

export function getAutoLocaleLanguageLabel(locale = detectSystemLocale()): string | undefined {
  if (!locale) return undefined

  const normalized = normalizeLocale(locale).split(".")[0]
  if (normalized.startsWith("en")) return undefined

  if (LOCALE_LANGUAGE_LABELS[normalized]) {
    return LOCALE_LANGUAGE_LABELS[normalized]
  }

  const prefix = normalized.split("-")[0]
  return LOCALE_LANGUAGE_LABELS[prefix]
}

export function buildAutomaticLocalePromptAppend(locale?: string): string | undefined {
  const languageLabel = getAutoLocaleLanguageLabel(locale)
  if (!languageLabel) return undefined

  return [
    "## Language Preference",
    `- User-visible explanation text: default to concise ${languageLabel}.`,
    "- Optimize for brevity: no bilingual duplication, no filler, no repeated paraphrase.",
    "- Keep code, commands, paths, identifiers, schemas, logs, and exact upstream error text unchanged.",
  ].join("\n")
}

export function applyAutomaticLocalePromptPreference<T extends AgentConfig>(config: T, locale?: string): T {
  if (typeof config.prompt !== "string") return config

  const appendix = buildAutomaticLocalePromptAppend(locale)
  if (!appendix) return config
  if (config.prompt.includes(appendix)) return config

  return {
    ...config,
    prompt: `${config.prompt}\n${appendix}`,
  }
}
