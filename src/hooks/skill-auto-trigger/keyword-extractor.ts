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
const MAX_KEYWORDS = 5

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

  // Deduplicate and take top N keywords
  const uniqueKeywords = [...new Set(words)].slice(0, MAX_KEYWORDS)

  if (uniqueKeywords.length === 0) {
    return null
  }

  // Build RegExp: \b(word1|word2|word3)\b with case-insensitive flag
  const pattern = `\\b(${uniqueKeywords.join("|")})\\b`
  return new RegExp(pattern, "i")
}

/**
 * Escapes special regex characters in a string.
 */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
