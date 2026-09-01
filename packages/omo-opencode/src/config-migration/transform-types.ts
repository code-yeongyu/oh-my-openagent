import type { DiscoveredLegacyConfigSource } from "./types"

export type LoadedLegacyConfigSource = {
  readonly path: string
  readonly value: unknown
}

export type ConfigMigrationTransformResult = {
  readonly diagnostics: readonly string[]
  readonly document: Record<string, unknown>
}

export type OpenCodeTransformScope =
  | { readonly kind: "user" }
  | { readonly kind: "project"; readonly projectRoot: string }

export type TransformOpenCodeSourcesInput = {
  readonly discovered: readonly DiscoveredLegacyConfigSource[]
  readonly scope: OpenCodeTransformScope
  readonly sources: readonly LoadedLegacyConfigSource[]
}

export type TransformConfigJsoncSourcesInput = {
  readonly discovered: readonly DiscoveredLegacyConfigSource[]
  readonly sources: readonly LoadedLegacyConfigSource[]
}
