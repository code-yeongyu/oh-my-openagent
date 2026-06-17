import { SUPPORTED_VARIANTS, type Variant } from "./registry"

/**
 * Canonical set of recognised variant / effort tokens.
 * Used by parseFallbackModelEntry (space-suffix detection) and
 * flattenToFallbackModelStrings (inline-variant stripping).
 */
export const KNOWN_VARIANTS = new Set<Variant>(Object.values(SUPPORTED_VARIANTS))

export function isKnownVariant(value: string | undefined | null): value is Variant {
  if (!value) return false;
  return KNOWN_VARIANTS.has(value as Variant);
}
