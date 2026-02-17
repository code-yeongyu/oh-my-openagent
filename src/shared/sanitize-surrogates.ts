/**
 * Sanitize lone surrogate characters in a string.
 * Replaces unpaired surrogates (U+D800..U+DFFF) with U+FFFD (replacement character).
 * Valid surrogate pairs are preserved.
 */
export function sanitizeSurrogates(s: string): string {
  if (typeof s !== 'string' || s.length === 0) return s
  if (typeof s.isWellFormed === 'function' && s.isWellFormed()) return s
  if (typeof s.toWellFormed === 'function') return s.toWellFormed()
  return s.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    '\uFFFD'
  )
}

/**
 * Deep sanitize all string values in a JSON-serializable object.
 */
export function deepSanitizeSurrogates(obj: unknown): unknown {
  if (typeof obj === 'string') return sanitizeSurrogates(obj)
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) return obj.map(deepSanitizeSurrogates)
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = deepSanitizeSurrogates(value)
    }
    return result
  }
  return obj
}
