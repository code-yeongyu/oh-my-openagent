/**
 * Deterministic model-identity pinning for byte-stable prompt selection.
 *
 * Sisyphus prompt reconciliation, ultrawork source detection, and
 * keyword-detector injection are pure functions of
 * (sessionID, agentName, modelID, variantID). The caches below memoize the
 * computed bytes per identity so repeated per-request calls return
 * byte-identical output without re-running the underlying builders.
 * A model or variant switch maps to a different key, so the bytes change
 * deterministically instead of drifting.
 */

export type ModelIdentity = {
  readonly sessionID: string
  readonly agentName: string
  readonly modelID: string
  readonly variantID?: string
}

export type RebuildIdentity = {
  readonly sessionID: string
  readonly configuredModel: string
  readonly runtimeModel: string
  readonly variantID?: string
}

const FIELD_SEPARATOR = "\0"

function normalizeVariant(variantID: string | undefined): string {
  return variantID ?? ""
}

export function toModelIdentityKey(identity: ModelIdentity): string {
  return [identity.sessionID, identity.agentName, identity.modelID, normalizeVariant(identity.variantID)].join(
    FIELD_SEPARATOR,
  )
}

export function toRebuildIdentityKey(identity: RebuildIdentity): string {
  return [
    identity.sessionID,
    identity.configuredModel,
    identity.runtimeModel,
    normalizeVariant(identity.variantID),
  ].join(FIELD_SEPARATOR)
}

export function readVariantID(model: unknown): string {
  if (typeof model === "object" && model !== null && "variant" in model) {
    const variant = (model as { readonly variant?: unknown }).variant
    if (typeof variant === "string") return variant
  }
  return ""
}

const ultraworkMessageCache = new Map<string, string>()
const rebuildPromptCache = new Map<string, string>()

export function clearModelIdentityPinCaches(): void {
  ultraworkMessageCache.clear()
  rebuildPromptCache.clear()
}

/**
 * Returns the cached ultrawork message for the identity, computing it once.
 * The compute closure must itself be a pure function of the identity.
 */
export function pinnedUltraworkMessage(identity: ModelIdentity, compute: () => string): string {
  const key = toModelIdentityKey(identity)
  const cached = ultraworkMessageCache.get(key)
  if (cached !== undefined) return cached
  const message = compute()
  ultraworkMessageCache.set(key, message)
  return message
}

/**
 * Returns the cached rebuilt Sisyphus prompt for the identity, rebuilding once.
 * The rebuild closure must be a pure function of the runtime model.
 */
export function pinnedRebuildPrompt(
  identity: RebuildIdentity,
  rebuild: (runtimeModel: string) => string,
): string {
  const key = toRebuildIdentityKey(identity)
  const cached = rebuildPromptCache.get(key)
  if (cached !== undefined) return cached
  const rebuilt = rebuild(identity.runtimeModel)
  rebuildPromptCache.set(key, rebuilt)
  return rebuilt
}
