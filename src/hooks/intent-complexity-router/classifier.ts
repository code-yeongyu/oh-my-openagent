export type ComplexityTier = "TRIVIAL" | "MODERATE" | "COMPLEX"

const TRIVIAL_PREFIXES = /^(what|which|who|where|list|show)\b/i

const COMPLEX_PATTERNS =
  /\b(implement|improve|refactor|analyze|analyse|create|build|PR|pull request|how should i|why|look into)\b/i

export function classifyIntent(message: string): ComplexityTier {
  const trimmed = message.trim()
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length

  if (COMPLEX_PATTERNS.test(trimmed)) {
    return "COMPLEX"
  }

  if (wordCount < 20 && TRIVIAL_PREFIXES.test(trimmed)) {
    return "TRIVIAL"
  }

  return "MODERATE"
}
