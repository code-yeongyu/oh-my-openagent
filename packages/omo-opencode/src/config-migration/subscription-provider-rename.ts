import type { ConfigMigrationTransformResult } from "./transform-types"

export const SUBSCRIPTION_PROVIDER_RENAME_MIGRATION_ID = "2026-09-subscription-provider-rename"

/**
 * Legacy subscription provider ids and the canonical id each became.
 *
 * The metered API-key lanes `openai` and `anthropic` are deliberately absent:
 * they were never renamed, and mapping them here would silently move a user
 * off the lane they are paying per-token for.
 */
const LEGACY_PROVIDER_IDS: Readonly<Record<string, string>> = Object.freeze({
  "claude-sdk-oauth": "anthropic-subscription",
  "openai-codex": "chatgpt-subscription",
})

/**
 * This migration is COSMETIC CONVERGENCE ONLY. Correctness already comes from
 * the engine normalizing legacy ids on read, so a config this never touches
 * still resolves. It therefore rewrites provider-bearing VALUES and nothing
 * else: unknown keys, custom categories and user comments are carried through
 * untouched, and a value it does not recognise is returned as-is.
 */
function renameProviderId(providerId: string): string | undefined {
  return LEGACY_PROVIDER_IDS[providerId]
}

function renameModelReference(modelReference: string): string | undefined {
  const providerSeparator = modelReference.indexOf("/")
  if (providerSeparator <= 0) return undefined
  const canonicalProvider = renameProviderId(modelReference.slice(0, providerSeparator))
  if (canonicalProvider === undefined) return undefined
  const modelPartVerbatim = modelReference.slice(providerSeparator)
  return `${canonicalProvider}${modelPartVerbatim}`
}

type Rewrite = { readonly path: string; readonly from: string; readonly to: string }

function rewriteValue(value: unknown, path: string, rewrites: Rewrite[]): unknown {
  if (typeof value === "string") {
    const renamed = renameModelReference(value) ?? renameProviderId(value)
    if (renamed === undefined) return value
    rewrites.push({ from: value, path, to: renamed })
    return renamed
  }
  if (Array.isArray(value)) return value.map((entry, index) => rewriteValue(entry, `${path}[${index}]`, rewrites))
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
        const canonicalKey = renameModelReference(key) ?? renameProviderId(key)
        const nextKey = canonicalKey ?? key
        if (canonicalKey !== undefined) rewrites.push({ from: key, path: `${path}.${key}`, to: canonicalKey })
        return [nextKey, rewriteValue(entry, `${path}.${nextKey}`, rewrites)]
      }),
    )
  }
  return value
}

export function hasLegacySubscriptionProviderIds(document: unknown): boolean {
  const rewrites: Rewrite[] = []
  rewriteValue(document, "$", rewrites)
  return rewrites.length > 0
}

export function transformSubscriptionProviderRename(document: unknown): ConfigMigrationTransformResult {
  const rewrites: Rewrite[] = []
  const rewritten = rewriteValue(document, "$", rewrites)
  const next = rewritten !== null && typeof rewritten === "object" && !Array.isArray(rewritten)
    ? (rewritten as Record<string, unknown>)
    : {}
  return {
    diagnostics: rewrites.map((rewrite) => `${rewrite.path}: ${rewrite.from} renamed to ${rewrite.to}`),
    document: next,
  }
}
