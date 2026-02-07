/**
 * Common words to filter out from keyword extraction.
 * These words appear frequently in descriptions but don't help identify skill relevance.
 */
const COMMON_WORDS = new Set([
  // Articles and prepositions
  "a", "an", "the", "to", "for", "of", "in", "on", "at", "by", "with", "from", "as",
  // Verbs
  "use", "used", "using", "is", "are", "was", "were", "be", "been", "being",
  "do", "does", "did", "have", "has", "had", "can", "could", "will", "would",
  "should", "may", "might", "must", "shall",
  // Pronouns and conjunctions
  "this", "that", "these", "those", "it", "its", "and", "or", "but", "if", "when",
  // Common descriptor words
  "any", "all", "some", "each", "every", "other", "more", "most", "very",
  // Skill description filler words
  "skill", "skills", "tool", "tools", "work", "working", "task", "tasks",
  "before", "after", "first", "then", "also", "only", "just", "even",
])

/**
 * Minimum word length to consider as a keyword.
 */
const MIN_WORD_LENGTH = 3

/**
 * Maximum number of keywords to extract per description.
 */
const MAX_KEYWORDS = 8

const WORD_BOUNDARY_TRIGGER = /^[A-Za-z0-9_]+(?:[ -][A-Za-z0-9_]+)*$/
const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]{2,}/g

function hasNonAsciiChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) > 127) {
      return true
    }
  }
  return false
}

export function buildTriggerRegex(triggers: string[]): RegExp | null {
  const cleaned = triggers
    .map((trigger) => trigger.trim())
    .filter((trigger) => trigger.length > 0)

  if (cleaned.length === 0) {
    return null
  }

  const uniqueTriggers = [...new Set(cleaned)]
  const patternParts = uniqueTriggers.map((trigger) => {
    const escaped = escapeRegExp(trigger)
    const useBoundary = !hasNonAsciiChar(trigger) && WORD_BOUNDARY_TRIGGER.test(trigger)
    return useBoundary ? `\\b${escaped}\\b` : escaped
  })

  return new RegExp(patternParts.join("|"), "i")
}

/**
 * Extracts meaningful keywords from a skill description.
 * Returns a RegExp that matches any of the extracted keywords.
 * 
 * @param description - The skill description text
 * @returns RegExp for matching keywords, or null if no keywords extracted
 * 
 * @example
 * extractKeywordsFromDescription("Use when debugging errors")
 * // Returns: /\b(debugging|errors)\b/i
 */
export function extractKeywordsFromDescription(description: string): RegExp | null {
  if (!description || typeof description !== "string") {
    return null
  }

  // Remove parentheses prefix like "(opencode - Skill)" or "(user - Skill)"
  const cleanedDescription = description.replace(/^\([^)]+\)\s*/, "")

  // Extract words: lowercase, remove punctuation, split by whitespace
  const words = cleanedDescription
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter(word => 
      word.length >= MIN_WORD_LENGTH && 
      !COMMON_WORDS.has(word) &&
      !/^\d+$/.test(word)  // Filter out pure numbers
    )

  const cjkTokens = cleanedDescription.match(CJK_RE) ?? []
  const uniqueKeywords = [...new Set([...cjkTokens, ...words])].slice(0, MAX_KEYWORDS)

  if (uniqueKeywords.length === 0) {
    return null
  }

  return buildTriggerRegex(uniqueKeywords)
}

/**
 * Escapes special regex characters in a string.
 */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
