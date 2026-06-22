import { appendBlock, findTomlSection, removeSetting, replaceOrInsertSetting } from "./toml-section-editor"

const CODEX_AGENTS_HEADER = "agents"
const CODEX_MULTI_AGENT_V2_HEADER = "features.multi_agent_v2"
const CODEX_SUBAGENT_THREAD_LIMIT = 1000

/**
 * Configure Codex subagent thread limits without forcing multi_agent_v2 on.
 *
 * Whether V2 is active is determined at runtime by the model's server-side
 * catalog entry (`ModelInfo.multi_agent_version`).  Forcing `enabled = true`
 * in config breaks models whose API does not support encrypted tool
 * parameters (e.g. gpt-5.5-medium, API-key-only models, third-party
 * providers).  The installer therefore sets only the v1 and v2 tuning knobs
 * so sessions keep the high subagent cap regardless of the active runtime.
 */
export function ensureCodexMultiAgentV2Config(config: string): string {
  const normalizedConfig = removeFeatureFlagSetting(config, "multi_agent_v2")
  const agentsConfig = ensureAgentsMaxThreads(normalizedConfig)
  const section = findTomlSection(agentsConfig, CODEX_MULTI_AGENT_V2_HEADER)
  const maxThreadsValue = CODEX_SUBAGENT_THREAD_LIMIT.toString()
  if (!section) {
    return appendBlock(
      agentsConfig,
      `[${CODEX_MULTI_AGENT_V2_HEADER}]\nmax_concurrent_threads_per_session = ${maxThreadsValue}\n`,
    )
  }

  return replaceOrInsertSetting(agentsConfig, section, "max_concurrent_threads_per_session", maxThreadsValue)
}

function removeFeatureFlagSetting(config: string, featureName: string): string {
  const section = findTomlSection(config, "features")
  if (!section) return config
  return removeSetting(config, section, featureName)
}

function ensureAgentsMaxThreads(config: string): string {
  const maxThreadsValue = CODEX_SUBAGENT_THREAD_LIMIT.toString()
  const section = findTomlSection(config, CODEX_AGENTS_HEADER)
  if (!section) {
    return appendBlock(config, `[${CODEX_AGENTS_HEADER}]\nmax_threads = ${maxThreadsValue}\n`)
  }
  return replaceOrInsertSetting(config, section, "max_threads", maxThreadsValue)
}
