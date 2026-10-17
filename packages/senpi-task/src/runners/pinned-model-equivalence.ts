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

/** A catalog priority alias, not a different SKU that happens to end in `-fast`. */
export function isPriorityAliasOf(entry: unknown, base: ModelIdentity): boolean {
  return typeof entry === "object" && entry !== null
    && "provider" in entry && entry.provider === base.provider
    && "id" in entry && typeof entry.id === "string" && priorityAliasBaseId(entry.id) === base.id
    && "serviceTier" in entry && entry.serviceTier === "priority"
    && "upstreamModelId" in entry && entry.upstreamModelId === base.id
}

/** The alias entry is the pairing proof in whichever direction the engine started. */
export function startedOnPinnedModel(started: ModelIdentity, pinned: ModelIdentity, pinnedEntry: unknown): boolean {
  if (started.provider !== pinned.provider) return false
  if (started.id === pinned.id) return true
  return isPriorityAliasOf(started, pinned) || isPriorityAliasOf(pinnedEntry, started)
}

/** The effective tier comes from the session, never the catalog's requested tier. */
export function reportedEffectiveModel(model: ModelIdentity | undefined, serviceTier: string | undefined): EffectiveModel | undefined {
  return model === undefined ? undefined : {
    provider: model.provider, id: model.id,
    ...(serviceTier === undefined ? {} : { serviceTier }),
  }
}
