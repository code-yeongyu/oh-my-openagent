/**
 * Canonical set of recognised variant / effort tokens.
 * Used by parseFallbackModelEntry (space-suffix detection) and
 * flattenToFallbackModelStrings (inline-variant stripping).
 */
export const KNOWN_VARIANTS = new Set([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "minimal",
  "none",
  "auto",
  "thinking",
])
