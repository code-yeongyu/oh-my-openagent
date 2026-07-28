import { AGENT_NAME_MAP, migrateAgentNames } from "@oh-my-opencode/utils/migration/agent-names"
import { HOOK_NAME_MAP } from "@oh-my-opencode/utils/migration/hook-names"
import { migrateModelVersions } from "@oh-my-opencode/utils/migration/model-versions"

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

function replaceDisabledAgents(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((entry) => {
    if (typeof entry !== "string") return entry
    return AGENT_NAME_MAP[entry.toLowerCase()] ?? AGENT_NAME_MAP[entry] ?? entry
  })
}

function replaceDisabledHooks(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.flatMap((entry) => {
    if (typeof entry !== "string") return [entry]
    const replacement = HOOK_NAME_MAP[entry]
    return replacement === null ? [] : [replacement ?? entry]
  })
}

function transformLegacyKeys(value: Readonly<Record<string, unknown>>, history: readonly string[]): Record<string, unknown> {
  const config = withoutLegacyMetadata(value)
  const appliedMigrations = new Set(history)
  const agents = config.agents
  if (isPlainRecord(agents)) {
    const namedAgents = migrateAgentNames(agents).migrated
    config.agents = migrateModelVersions(namedAgents, appliedMigrations).migrated
  }
  const categories = config.categories
  if (isPlainRecord(categories)) {
    config.categories = migrateModelVersions(categories, appliedMigrations).migrated
  }
  if (config.omo_agent !== undefined) {
    config.sisyphus_agent = config.omo_agent
    delete config.omo_agent
  }
  delete config.lsp
  if (isPlainRecord(config.experimental) && Object.hasOwn(config.experimental, "hashline_edit")) {
    if (config.hashline_edit === undefined) config.hashline_edit = config.experimental.hashline_edit
    delete config.experimental.hashline_edit
    if (Object.keys(config.experimental).length === 0) delete config.experimental
  }
  if (config.disabled_agents !== undefined) config.disabled_agents = replaceDisabledAgents(config.disabled_agents)
  if (config.disabled_hooks !== undefined) config.disabled_hooks = replaceDisabledHooks(config.disabled_hooks)
  return config
}

function loadedConfigs(
  discovered: readonly DiscoveredLegacyConfigSource[],
  sources: readonly LoadedLegacyConfigSource[],
): readonly LoadedConfig[] {
  const metadataByPath = new Map(discovered.map((source) => [source.path, source]))
  const historyByConfigPath = legacyMigrationHistory(discovered, sources)
  const configs: LoadedConfig[] = []
  for (const source of sources) {
    const metadata = metadataByPath.get(source.path)
    if (metadata === undefined || !isPlainRecord(source.value) || metadata.kind === "migration-sidecar") continue
    configs.push({
      metadata,
      value: transformLegacyKeys(source.value, historyByConfigPath[metadata.configPath] ?? []),
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
