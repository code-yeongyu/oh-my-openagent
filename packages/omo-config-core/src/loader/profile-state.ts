import { loadOmoConfig } from "./loader"
import { mergeOmoConfigRecords } from "./merge"
import { readPersistedOmoProfileFromLayers, resolveOmoProfile, type ResolvedOmoProfile } from "./resolution"
import type { LoadOmoConfigOptions, OmoConfigDiagnostic, OmoConfigSource } from "./types"

export type OmoProfileState = {
  readonly active?: ResolvedOmoProfile
  readonly diagnostics: readonly OmoConfigDiagnostic[]
  readonly persisted?: string
  readonly profiles: readonly string[]
  readonly requested?: ResolvedOmoProfile
  readonly sources: readonly OmoConfigSource[]
  readonly userProfiles: readonly string[]
}

function definedProfileNames(config: Readonly<Record<string, unknown>>): readonly string[] {
  const profiles = config["profiles"]
  if (profiles === null || typeof profiles !== "object" || Array.isArray(profiles)) return []
  return Object.keys(profiles).sort()
}

export function readOmoProfileState(options: LoadOmoConfigOptions = {}): OmoProfileState {
  const loaded = loadOmoConfig(options)
  let merged: Record<string, unknown> = {}
  let user: Record<string, unknown> = {}
  for (const layer of loaded.layers) merged = mergeOmoConfigRecords(merged, layer.config)
  for (const layer of loaded.layers) {
    if (layer.source.scope === "user") user = mergeOmoConfigRecords(user, layer.config)
  }

  const persisted = readPersistedOmoProfileFromLayers(loaded.layers).persisted
  const requested = resolveOmoProfile({
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(persisted === undefined ? {} : { persisted }),
    ...(options.profile === undefined ? {} : { profile: options.profile }),
  })
  const active = requested !== undefined && loaded.profile === requested.name ? requested : undefined

  return {
    ...(active === undefined ? {} : { active }),
    diagnostics: loaded.diagnostics,
    ...(persisted === undefined ? {} : { persisted }),
    profiles: definedProfileNames(merged),
    ...(requested === undefined ? {} : { requested }),
    sources: loaded.sources,
    userProfiles: definedProfileNames(user),
  }
}
