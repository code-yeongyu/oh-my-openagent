import { deepDifference } from "./deep-diff"
import { legacyMigrationHistory } from "./legacy-history"
import { isPlainRecord, mergeRecords, withoutLegacyMetadata } from "./record-values"
import { OMO_SCHEMA_URL } from "./schema-url"
import type { DiscoveredLegacyConfigSource } from "./types"
import type { TransformOpenCodeSourcesInput, ConfigMigrationTransformResult, LoadedLegacyConfigSource } from "./transform-types"

type LoadedConfig = {
  readonly metadata: DiscoveredLegacyConfigSource
  readonly value: Record<string, unknown>
}

const MIGRATED_OPENCODE_FIELDS = new Set([
  "disabled_providers",
  "model_fallback",
  "models",
  "sisyphus_agent",
])

function transformLegacyKeys(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const config = withoutLegacyMetadata(value)
  delete config.agents
  delete config.categories
  if (config.omo_agent !== undefined) {
    config.sisyphus_agent = config.omo_agent
    delete config.omo_agent
  }
  return Object.fromEntries(
    Object.entries(config).filter(([key]) => MIGRATED_OPENCODE_FIELDS.has(key)),
  )
}

function loadedConfigs(
  discovered: readonly DiscoveredLegacyConfigSource[],
  sources: readonly LoadedLegacyConfigSource[],
): readonly LoadedConfig[] {
  const metadataByPath = new Map(discovered.map((source) => [source.path, source]))
  const configs: LoadedConfig[] = []
  for (const source of sources) {
    const metadata = metadataByPath.get(source.path)
    if (metadata === undefined || !isPlainRecord(source.value) || metadata.kind === "migration-sidecar") continue
    configs.push({
      metadata,
      value: transformLegacyKeys(source.value),
    })
  }
  return configs
}

function mergedConfigs(configs: readonly LoadedConfig[]): Record<string, unknown> {
  return [...configs]
    .sort((left, right) => right.metadata.precedence - left.metadata.precedence)
    .reduce((merged, config) => mergeRecords(merged, config.value), {})
}

function documentWithHistory(
  opencode: Record<string, unknown>,
  profiles: Record<string, unknown>,
  discovered: readonly DiscoveredLegacyConfigSource[],
  sources: readonly LoadedLegacyConfigSource[],
): ConfigMigrationTransformResult {
  const history = legacyMigrationHistory(discovered, sources)
  return {
    diagnostics: [],
    document: {
      $schema: OMO_SCHEMA_URL,
      ...(Object.keys(opencode).length === 0 ? {} : { "[opencode]": opencode }),
      ...(Object.keys(profiles).length === 0 ? {} : { profiles }),
      ...(Object.keys(history).length === 0 ? {} : { legacy_migrations: history }),
    },
  }
}

function transformUserSources(
  discovered: readonly DiscoveredLegacyConfigSource[],
  sources: readonly LoadedLegacyConfigSource[],
): ConfigMigrationTransformResult {
  const configs = loadedConfigs(discovered, sources)
  const rootConfigs = configs.filter((config) => config.metadata.kind === "user-config")
  const rootByDirectory = new Map<string, Record<string, unknown>>()
  for (const root of new Set(rootConfigs.map((config) => config.metadata.baseRoot))) {
    if (root === undefined) continue
    rootByDirectory.set(root, mergedConfigs(rootConfigs.filter((config) => config.metadata.baseRoot === root)))
  }
  const profiles: Record<string, unknown> = {}
  for (const profile of new Set(configs.map((config) => config.metadata.profile))) {
    if (profile === undefined) continue
    const profileConfigs = configs.filter((config) => config.metadata.kind === "profile-config" && config.metadata.profile === profile)
    const differences = profileConfigs.map((config) => ({
      metadata: config.metadata,
      value: deepDifference(rootByDirectory.get(config.metadata.baseRoot ?? "") ?? {}, config.value),
    }))
    const difference = mergedConfigs(differences)
    if (Object.keys(difference).length > 0) profiles[profile] = { "[opencode]": difference }
  }
  return documentWithHistory(mergedConfigs(rootConfigs), profiles, discovered.filter((source) => source.projectRoot === undefined), sources)
}

function transformProjectSources(
  input: TransformOpenCodeSourcesInput,
  projectRoot: string,
): ConfigMigrationTransformResult {
  const discovered = input.discovered.filter((source) => source.projectRoot === projectRoot)
  const configs = loadedConfigs(discovered, input.sources)
  return documentWithHistory(mergedConfigs(configs), {}, discovered, input.sources)
}

export function transformOpenCodeSources(input: TransformOpenCodeSourcesInput): ConfigMigrationTransformResult {
  return input.scope.kind === "user"
    ? transformUserSources(input.discovered, input.sources)
    : transformProjectSources(input, input.scope.projectRoot)
}
