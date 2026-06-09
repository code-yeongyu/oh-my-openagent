import { appendBlock, findTomlSection, removeSetting, replaceOrInsertSetting } from "./toml-section-editor"

const CODEX_MULTI_AGENT_V2_HEADER = "features.multi_agent_v2"
const CODEX_MULTI_AGENT_V2_MAX_CONCURRENT_THREADS_PER_SESSION = 10000

/**
 * Configure multi_agent_v2 thread limits without forcing the feature on.
 *
 * Whether V2 is active is determined at runtime by the model's server-side
 * catalog entry (`ModelInfo.multi_agent_version`).  Forcing `enabled = true`
 * in config breaks models whose API does not support encrypted tool
 * parameters (e.g. gpt-5.5-medium, API-key-only models, third-party
 * providers).  The installer therefore only sets the tuning knob
 * (`max_concurrent_threads_per_session`) so that sessions that DO activate
 * V2 benefit from the higher limit.
 */
export function ensureCodexMultiAgentV2Config(config: string): string {
  const normalizedConfig = removeLegacyAgentsMaxThreadsSetting(removeFeatureFlagSetting(config, "multi_agent_v2"))
  const section = findTomlSection(normalizedConfig, CODEX_MULTI_AGENT_V2_HEADER)
  const maxThreadsValue = CODEX_MULTI_AGENT_V2_MAX_CONCURRENT_THREADS_PER_SESSION.toString()
  if (!section) {
    return appendBlock(
      normalizedConfig,
      `[${CODEX_MULTI_AGENT_V2_HEADER}]\nmax_concurrent_threads_per_session = ${maxThreadsValue}\n`,
    )
  }

  return replaceOrInsertSetting(normalizedConfig, section, "max_concurrent_threads_per_session", maxThreadsValue)
}

function removeFeatureFlagSetting(config: string, featureName: string): string {
  const section = findTomlSection(config, "features")
  if (!section) return config
  return removeSetting(config, section, featureName)
}

function removeLegacyAgentsMaxThreadsSetting(config: string): string {
  const section = findTomlSection(config, "agents")
  if (!section) return config
  return removeSetting(config, section, "max_threads")
}
