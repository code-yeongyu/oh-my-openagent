import { deepDifference } from "./deep-diff"
import { legacyMigrationHistory } from "./legacy-history"
import { isPlainRecord, mergeRecords, withoutLegacyMetadata } from "./record-values"
import { OMO_SCHEMA_URL } from "./schema-url"
import type { DiscoveredLegacyConfigSource } from "./types"
import type {
  TransformOpenCodeSourcesInput,
  ConfigMigrationTransformResult,
  LoadedLegacyConfigSource,
} from "./transform-types"

type LoadedConfig = {
  readonly metadata: DiscoveredLegacyConfigSource
  readonly value: Record<string, unknown>
}

/**
 * Legacy top-level keys deliberately left unimported: `agents` and `categories` overrides moved to
 * the shared base and `[native]` blocks with different shapes (#10139), so they have no
 * unambiguous current equivalent and are reported as not imported instead.
 */
export const OMITTED_LEGACY_OPENCODE_KEYS: ReadonlySet<string> = new Set(["agents", "categories"])

/**
 * Legacy top-level keys the current `[opencode]` view still accepts under the same name
 * (`assets/omo.schema.json` `#/definitions/opencode`), plus `models`, which predates the view
 * schema and has always been carried by this transform. Every other legacy key has no current
 * equivalent and is reported as `not imported: <key>` so no value is dropped silently (#10957).
 */
export const IMPORTABLE_OPENCODE_KEYS: ReadonlySet<string> = new Set([
  "agent_definitions",
  "agent_order",
  "auto_update",
  "babysitting",
  "background_task",
  "browser_automation_engine",
  "claude_code",
  "comment_checker",
  "default_mode",
  "default_run_agent",
  "disabled_agents",
  "disabled_commands",
  "disabled_hooks",
  "disabled_mcps",
  "disabled_providers",
  "disabled_skills",
  "disabled_tools",
  "experimental",
  "git_master",
  "goal",
  "hashline_edit",
  "i18n",
  "keyword_detector",
  "mcp_env_allowlist",
  "model_capabilities",
  "model_fallback",
  "models",
  "monitor",
  "new_task_system_enabled",
  "notification",
  "openclaw",
  "ralph_loop",
  "runtime_fallback",
  "sisyphus",
  "sisyphus_agent",
  "skills",
  "start_work",
  "team_mode",
  "telemetry",
  "tmux",
  "tui",
  "ulw_execute",
  "websearch",
])

type TransformedLegacyKeys = {
  readonly imported: Record<string, unknown>
  readonly notImported: readonly string[]
}

function transformLegacyKeys(value: Readonly<Record<string, unknown>>): TransformedLegacyKeys {
  const config = withoutLegacyMetadata(value)
  if (config.omo_agent !== undefined) {
    config.sisyphus_agent = config.omo_agent
    delete config.omo_agent
  }
  const imported: Record<string, unknown> = {}
  const notImported = new Set<string>()
  for (const [key, entry] of Object.entries(config)) {
    if (IMPORTABLE_OPENCODE_KEYS.has(key)) imported[key] = entry
    else notImported.add(key)
  }
  return { imported, notImported: [...notImported].sort() }
}

type LoadedConfigWithDrops = {
  readonly configs: readonly LoadedConfig[]
  readonly notImported: readonly string[]
}

function loadedConfigs(
  discovered: readonly DiscoveredLegacyConfigSource[],
  sources: readonly LoadedLegacyConfigSource[],
): LoadedConfigWithDrops {
  const metadataByPath = new Map(discovered.map((source) => [source.path, source]))
  const configs: LoadedConfig[] = []
  const notImported = new Set<string>()
  for (const source of sources) {
    const metadata = metadataByPath.get(source.path)
    if (metadata === undefined || !isPlainRecord(source.value) || metadata.kind === "migration-sidecar") continue
    const transformed = transformLegacyKeys(source.value)
    configs.push({ metadata, value: transformed.imported })
    for (const key of transformed.notImported) notImported.add(key)
  }
  return { configs, notImported: [...notImported].sort() }
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
  notImported: readonly string[],
): ConfigMigrationTransformResult {
  const history = legacyMigrationHistory(discovered, sources)
  return {
    diagnostics: notImported.map((key) => `not imported: ${key}`),
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
  const { configs, notImported } = loadedConfigs(discovered, sources)
  const rootConfigs = configs.filter((config) => config.metadata.kind === "user-config")
  const rootByDirectory = new Map<string, Record<string, unknown>>()
  for (const root of new Set(rootConfigs.map((config) => config.metadata.baseRoot))) {
    if (root === undefined) continue
    rootByDirectory.set(root, mergedConfigs(rootConfigs.filter((config) => config.metadata.baseRoot === root)))
  }
  const profiles: Record<string, unknown> = {}
  for (const profile of new Set(configs.map((config) => config.metadata.profile))) {
    if (profile === undefined) continue
    const profileConfigs = configs.filter(
      (config) => config.metadata.kind === "profile-config" && config.metadata.profile === profile,
    )
    const differences = profileConfigs.map((config) => ({
      metadata: config.metadata,
      value: deepDifference(rootByDirectory.get(config.metadata.baseRoot ?? "") ?? {}, config.value),
    }))
    const difference = mergedConfigs(differences)
    if (Object.keys(difference).length > 0) profiles[profile] = { "[opencode]": difference }
  }
  return documentWithHistory(
    mergedConfigs(rootConfigs),
    profiles,
    discovered.filter((source) => source.projectRoot === undefined),
    sources,
    notImported,
  )
}

function transformProjectSources(
  input: TransformOpenCodeSourcesInput,
  projectRoot: string,
): ConfigMigrationTransformResult {
  const discovered = input.discovered.filter((source) => source.projectRoot === projectRoot)
  const { configs, notImported } = loadedConfigs(discovered, input.sources)
  return documentWithHistory(mergedConfigs(configs), {}, discovered, input.sources, notImported)
}

export function transformOpenCodeSources(input: TransformOpenCodeSourcesInput): ConfigMigrationTransformResult {
  return input.scope.kind === "user"
    ? transformUserSources(input.discovered, input.sources)
    : transformProjectSources(input, input.scope.projectRoot)
}
