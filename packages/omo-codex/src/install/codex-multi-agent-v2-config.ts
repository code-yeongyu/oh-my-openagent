import { readFileSync } from "node:fs"
import { dirname, isAbsolute, join } from "node:path"

import { appendBlock, escapeRegExp, findTomlSection, removeSetting, replaceOrInsertSetting } from "./toml-section-editor"

const CODEX_AGENTS_HEADER = "agents"
const CODEX_MULTI_AGENT_V2_HEADER = "features.multi_agent_v2"
const CODEX_SUBAGENT_THREAD_LIMIT = 1000
const CODEX_MULTI_AGENT_V2_THREAD_LIMIT = 16

export type CodexMultiAgentVersion = "v1" | "v2" | null

/**
 * Configure Codex subagent thread limits without forcing multi_agent_v2 on.
 *
 * Whether V2 is active is determined at runtime by the model's server-side
 * catalog entry (`ModelInfo.multi_agent_version`).  Forcing `enabled = true`
 * in config breaks models whose API does not support encrypted tool
 * parameters (e.g. gpt-5.5-medium, API-key-only models, third-party
 * providers).  The installer therefore sets only the v1 and v2 tuning knobs
 * so sessions keep the high subagent cap regardless of the active runtime.
 *
 * When the selected model prefers V2 (catalog `multi_agent_version: "v2"`,
 * or a GPT-5.6 family model with the catalog unavailable), the installer
 * additionally skips/removes `agents.max_threads` (Codex rejects it while
 * MultiAgentV2 is enabled) and does not materialize `enabled = false` from
 * the legacy `[features]` boolean shorthand (a config-level disable
 * mismatches the reserved `collaboration.spawn_agent` schema on some Codex
 * versions - oh-my-openagent#6002 / #6008).
 *
 * When config.toml names no root model at all (Codex Desktop selects the
 * model in the UI), the installer never introduces `agents.max_threads`:
 * Codex rejects that key at thread/start while MultiAgentV2 is active. An
 * existing cap is still raised in place so the legacy low-cap repair keeps
 * working and a hand-removed key stays removed.
 */
export function ensureCodexMultiAgentV2Config(
  config: string,
  options: { readonly multiAgentVersion?: CodexMultiAgentVersion } = {},
): string {
  const featureFlag = removeFeatureFlagSetting(config, "multi_agent_v2")
  const v2Preferred = options.multiAgentVersion === "v2"
  const modelKnown = options.multiAgentVersion != null || readRootModel(featureFlag.config) !== null
  const agentsConfig = v2Preferred
    ? removeAgentsMaxThreads(featureFlag.config)
    : modelKnown
      ? ensureAgentsMaxThreads(featureFlag.config)
      : raiseExistingAgentsMaxThreads(featureFlag.config)
  const preserveDisable = featureFlag.value === false && !v2Preferred
  const featureConfig = preserveDisable
    ? setMultiAgentV2Disable(agentsConfig)
    : v2Preferred
      ? removeMultiAgentV2Disable(agentsConfig)
      : agentsConfig
  const section = findTomlSection(featureConfig, CODEX_MULTI_AGENT_V2_HEADER)
  if (!section) {
    const enabledSetting = preserveDisable ? "enabled = false\n" : ""
    return appendBlock(
      featureConfig,
      `[${CODEX_MULTI_AGENT_V2_HEADER}]\n${enabledSetting}max_concurrent_threads_per_session = ${CODEX_MULTI_AGENT_V2_THREAD_LIMIT}\n`,
    )
  }
  if (/^\s*max_concurrent_threads_per_session\s*=/m.test(section.text)) return featureConfig
  return replaceOrInsertSetting(
    featureConfig,
    section,
    "max_concurrent_threads_per_session",
    CODEX_MULTI_AGENT_V2_THREAD_LIMIT.toString(),
  )
}

/**
 * Resolve the configured root model's multi-agent version from the Codex
 * model catalog cache (`models_cache.json` next to `config.toml`).
 * Mirrors `plugin/scripts/migrate-codex-config/multi-agent-v2-guard.mjs`:
 * catalog wins; a GPT-5.6 family model with no catalog entry counts as V2.
 */
export function resolveCodexMultiAgentVersion(config: string, configPath: string): CodexMultiAgentVersion {
  const model = readRootModel(config)
  if (model === null) return null
  const catalogPath = resolveCatalogPath(readRootModelCatalogPath(config), configPath)
  const catalogVersion = readCatalogMultiAgentVersion(model, catalogPath)
  if (catalogVersion !== null) return catalogVersion
  return /^gpt-5\.6\b/i.test(model) ? "v2" : null
}

function resolveCatalogPath(configuredPath: string | null, configPath: string): string {
  if (configuredPath === null) return join(dirname(configPath), "models_cache.json")
  return isAbsolute(configuredPath) ? configuredPath : join(dirname(configPath), configuredPath)
}

function readCatalogMultiAgentVersion(model: string, cachePath: string): CodexMultiAgentVersion {
  let raw: string
  try {
    raw = readFileSync(cachePath, "utf8")
  } catch {
    return null
  }
  let cache: unknown
  try {
    cache = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(cache) || !Array.isArray(cache.models)) return null
  for (const entry of cache.models) {
    if (!isRecord(entry)) continue
    if (entry.slug !== model && entry.id !== model) continue
    const version = entry.multi_agent_version
    if (version === "v1" || version === "v2") return version
    return null
  }
  return null
}

function readRootModel(config: string): string | null {
  const double = config.match(/^\s*model\s*=\s*"([^"]+)"/m)
  if (double !== null) return double[1] ?? null
  const single = config.match(/^\s*model\s*=\s*'([^']+)'/m)
  return single?.[1] ?? null
}

function readRootModelCatalogPath(config: string): string | null {
  const double = config.match(/^\s*model_catalog_json\s*=\s*"([^"]+)"/m)
  if (double !== null) return double[1] ?? null
  const single = config.match(/^\s*model_catalog_json\s*=\s*'([^']+)'/m)
  return single?.[1] ?? null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function removeFeatureFlagSetting(
  config: string,
  featureName: string,
): {
  readonly config: string
  readonly value: boolean | null
} {
  const section = findTomlSection(config, "features")
  if (!section) return { config, value: null }
  return {
    config: removeSetting(config, section, featureName),
    value: readBooleanSetting(section.text, featureName),
  }
}

function ensureAgentsMaxThreads(config: string): string {
  const maxThreadsValue = CODEX_SUBAGENT_THREAD_LIMIT.toString()
  const section = findTomlSection(config, CODEX_AGENTS_HEADER)
  if (!section) {
    return appendBlock(config, `[${CODEX_AGENTS_HEADER}]\nmax_threads = ${maxThreadsValue}\n`)
  }
  return replaceOrInsertSetting(config, section, "max_threads", maxThreadsValue)
}

function removeAgentsMaxThreads(config: string): string {
  const section = findTomlSection(config, CODEX_AGENTS_HEADER)
  if (!section) return config
  if (!/^\s*max_threads\s*=/m.test(section.text)) return config
  return removeSetting(config, section, "max_threads")
}

function removeMultiAgentV2Disable(config: string): string {
  const section = findTomlSection(config, CODEX_MULTI_AGENT_V2_HEADER)
  if (!section) return config
  if (!/^\s*enabled\s*=\s*false(?:\s*#.*)?$/m.test(section.text)) return config
  return removeSetting(config, section, "enabled")
}

function setMultiAgentV2Disable(config: string): string {
  const section = findTomlSection(config, CODEX_MULTI_AGENT_V2_HEADER)
  if (!section) return config
  return replaceOrInsertSetting(config, section, "enabled", "false")
}

function raiseExistingAgentsMaxThreads(config: string): string {
  const section = findTomlSection(config, CODEX_AGENTS_HEADER)
  if (!section) return config
  if (!/^\s*max_threads\s*=/m.test(section.text)) return config
  return replaceOrInsertSetting(config, section, "max_threads", CODEX_SUBAGENT_THREAD_LIMIT.toString())
}

function readBooleanSetting(sectionText: string, key: string): boolean | null {
  const match = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(true|false)\\s*(?:#.*)?$`, "m").exec(sectionText)
  if (!match) return null
  return match[1] === "true"
}
