export interface ModelIdentity {
  readonly provider: string
  readonly id: string
}

export type CatalogModelIdentity = ModelIdentity & {
  readonly serviceTier?: string
  readonly upstreamModelId?: string
}

export type EffectiveModel = ModelIdentity & { readonly serviceTier?: string }

/** The alias spelling is shared by catalog validation, lookup gating and rendering. */
export function priorityAliasBaseId(id: string): string | undefined {
  const suffix = "-fast"
  return id.endsWith(suffix) ? id.slice(0, -suffix.length) : undefined
}

export function differsOnlyByPriorityAlias(started: ModelIdentity, pinned: ModelIdentity): boolean {
  return started.provider === pinned.provider && started.id !== pinned.id
    && (priorityAliasBaseId(started.id) === pinned.id || priorityAliasBaseId(pinned.id) === started.id)
}

/**
 * senpi's own pairing accessors (`ModelRegistry.getServiceTier` / `getUpstreamModelId`). They resolve
 * an extension provider's model, then the models.json definition, then the raw entry, and senpi's
 * service-tier extension starts a `-fast` alias on its base exactly when they pair it (#10536).
 * Method syntax keeps senpi's `Model`-typed signatures assignable; they read only provider and id.
 */
export interface PriorityPairingRegistry {
  getServiceTier?(model: ModelIdentity): string | undefined
  getUpstreamModelId?(model: ModelIdentity): string | undefined
}

interface AliasPairing {
  readonly serviceTier: unknown
  readonly upstreamModelId: unknown
}

function aliasPairing(entry: ModelIdentity & object, registry: PriorityPairingRegistry | undefined): AliasPairing {
  if (registry?.getServiceTier !== undefined && registry.getUpstreamModelId !== undefined) {
    return { serviceTier: registry.getServiceTier(entry), upstreamModelId: registry.getUpstreamModelId(entry) }
  }
  return {
    serviceTier: "serviceTier" in entry ? entry.serviceTier : undefined,
    upstreamModelId: "upstreamModelId" in entry ? entry.upstreamModelId : undefined,
  }
}

function isModelIdentity(entry: unknown): entry is ModelIdentity & object {
  return typeof entry === "object" && entry !== null
    && "provider" in entry && typeof entry.provider === "string"
    && "id" in entry && typeof entry.id === "string"
}

/**
 * A catalog priority alias, not a different SKU that happens to end in `-fast`. With a registry in
 * scope the pairing is read the way senpi reads it; without one, from the entry's own fields.
 */
export function isPriorityAliasOf(entry: unknown, base: ModelIdentity, registry?: PriorityPairingRegistry): boolean {
  if (!isModelIdentity(entry) || entry.provider !== base.provider || priorityAliasBaseId(entry.id) !== base.id) return false
  const pairing = aliasPairing(entry, registry)
  return pairing.serviceTier === "priority" && pairing.upstreamModelId === base.id
}

/** The alias entry is the pairing proof in whichever direction the engine started. */
export function startedOnPinnedModel(
  started: ModelIdentity,
  pinned: ModelIdentity,
  pinnedEntry: unknown,
  registry?: PriorityPairingRegistry,
): boolean {
  if (started.provider !== pinned.provider) return false
  if (started.id === pinned.id) return true
  return isPriorityAliasOf(started, pinned, registry) || isPriorityAliasOf(pinnedEntry, started, registry)
}

/** The effective tier comes from the session, never the catalog's requested tier. */
export function reportedEffectiveModel(model: ModelIdentity | undefined, serviceTier: string | undefined): EffectiveModel | undefined {
  return model === undefined ? undefined : {
    provider: model.provider, id: model.id,
    ...(serviceTier === undefined ? {} : { serviceTier }),
  }
}
