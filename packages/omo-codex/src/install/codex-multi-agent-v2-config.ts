import { readFileSync } from "node:fs"
import { dirname, isAbsolute, join } from "node:path"

import {
  appendBlock,
  escapeRegExp,
  findTomlSection,
  parseTomlDottedKey,
  removeSetting,
  replaceOrInsertSetting,
  scanTomlMultilineLine,
  type TomlMultilineQuote,
  type TomlSection,
} from "./toml-section-editor"

const CODEX_AGENTS_HEADER = "agents"
const CODEX_MULTI_AGENT_V2_HEADER = "features.multi_agent_v2"

export type CodexMultiAgentVersion = "v1" | "v2" | null

/**
 * Configure Codex subagent thread limits without forcing multi_agent_v2 on.
 *
 * Whether V2 is active is determined at runtime by the model's server-side
 * catalog entry (`ModelInfo.multi_agent_version`).  Forcing `enabled = true`
 * in config breaks models whose API does not support encrypted tool
 * parameters (e.g. gpt-5.5-medium, API-key-only models, third-party
 * providers). The installer never inserts or raises either concurrency cap;
 * it removes only the values previously written by LazyCodex.
 *
 * When the selected model prefers V2 (catalog `multi_agent_version: "v2"`,
 * or a GPT-5.6 or GPT-6 family model with the catalog unavailable), the installer
 * additionally skips/removes `agents.max_threads` (Codex rejects it while
 * MultiAgentV2 is enabled) and does not materialize `enabled = false` from
 * the legacy `[features]` boolean shorthand (a config-level disable
 * mismatches the reserved `collaboration.spawn_agent` schema on some Codex
 * versions - oh-my-openagent#6002 / #6008).
 *
 * Other user values are preserved, except that V2-preferred models still
 * remove the incompatible `agents.max_threads` key.
 */
export function ensureCodexMultiAgentV2Config(
  config: string,
  options: { readonly multiAgentVersion?: CodexMultiAgentVersion } = {},
): string {
  const featureFlag = removeFeatureFlagSetting(config, "multi_agent_v2")
  // Keep this V2-active rule aligned with plugin/scripts/migrate-codex-config/subagent-limit-guard.mjs.
  const v2Preferred = options.multiAgentVersion === "v2"
    || isMultiAgentV2Enabled(featureFlag.config)
  const agentsConfig = removeAgentsMaxThreads(featureFlag.config, v2Preferred)
  const preserveDisable = featureFlag.value === false && !v2Preferred
  const featureConfig = preserveDisable
    ? setMultiAgentV2Disable(agentsConfig)
    : v2Preferred
      ? removeMultiAgentV2Disable(agentsConfig)
      : agentsConfig
  const withoutManagedLimit = removeManagedMultiAgentV2ThreadLimit(featureConfig)
  if (preserveDisable && !findTomlSection(withoutManagedLimit, CODEX_MULTI_AGENT_V2_HEADER)) {
    return appendBlock(withoutManagedLimit, `[${CODEX_MULTI_AGENT_V2_HEADER}]\nenabled = false`)
  }
  return withoutManagedLimit
}

/**
 * Resolve the configured root model's multi-agent version from the Codex
 * model catalog cache (`models_cache.json` next to `config.toml`).
 * Mirrors `plugin/scripts/migrate-codex-config/multi-agent-v2-guard.mjs`:
 * catalog wins; GPT-5.6 and GPT-6 models with no catalog entry count as V2.
 */
export function resolveCodexMultiAgentVersion(config: string, configPath: string): CodexMultiAgentVersion {
  const model = readRootModel(config)
  if (model === null) return null
  const catalogPath = resolveCatalogPath(readRootModelCatalogPath(config), configPath)
  const catalogVersion = readCatalogMultiAgentVersion(model, catalogPath)
  if (catalogVersion !== null) return catalogVersion
  return /^(?:gpt-5\.6|gpt-6)\b/i.test(model) ? "v2" : null
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

function isMultiAgentV2Enabled(config: string): boolean {
  const section = findTomlSection(config, CODEX_MULTI_AGENT_V2_HEADER)
  return section !== null && /^\s*enabled\s*=\s*true[ \t]*(?:#.*)?$/m.test(section.text)
}

function removeAgentsMaxThreads(config: string, v2Preferred: boolean): string {
  const section = findTomlSection(config, CODEX_AGENTS_HEADER)
  if (!section) return config
  return removeMatchingCap(config, section, "max_threads", v2Preferred ? undefined : /^1000\s*(?:#.*)?$/)
}

function removeManagedMultiAgentV2ThreadLimit(config: string): string {
  const section = findTomlSection(config, CODEX_MULTI_AGENT_V2_HEADER)
  if (!section) return config
  return removeMatchingCap(config, section, "max_concurrent_threads_per_session", /^(?:1000|16)\s*(?:#.*)?$/)
}

function removeMatchingCap(config: string, section: TomlSection, keyName: string, expectedValue?: RegExp): string {
  let quote: TomlMultilineQuote | null = null
  let offset = section.start
  for (const line of section.text.match(/[^\n]*\n?/g) ?? []) {
    const scan = scanTomlMultilineLine(line, quote)
    quote = scan.nextQuote
    if (!scan.wasInside) {
      const assignment = line.indexOf("=")
      const key = assignment < 0 ? null : parseTomlDottedKey(line.slice(0, assignment).trim())
      if (key?.length === 1 && key[0] === keyName
        && (expectedValue === undefined || expectedValue.test(line.slice(assignment + 1).trim()))) {
        return config.slice(0, offset) + config.slice(offset + line.length)
      }
    }
    offset += line.length
  }
  return config
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

function readBooleanSetting(sectionText: string, key: string): boolean | null {
  const match = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(true|false)\\s*(?:#.*)?$`, "m").exec(sectionText)
  if (!match) return null
  return match[1] === "true"
}
