import { replaceOrInsertRootSetting } from "./toml-section-editor"

const CODEX_MULTI_AGENT_MODE_KEY = "multi_agent_mode"
const CODEX_MULTI_AGENT_MODE_STEERING = "steering"

export function ensureCodexMultiAgentModeConfig(config: string): string {
  if (readRootStringSetting(config, CODEX_MULTI_AGENT_MODE_KEY) === CODEX_MULTI_AGENT_MODE_STEERING) {
    return config
  }
  return replaceOrInsertRootSetting(
    config,
    CODEX_MULTI_AGENT_MODE_KEY,
    JSON.stringify(CODEX_MULTI_AGENT_MODE_STEERING),
  )
}

function readRootStringSetting(config: string, key: string): string | null {
  for (const line of config.split(/\n/)) {
    if (isSectionHeader(line)) return null
    const match = line.trimStart().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]*)"/)
    if (match?.[1] === key) return match[2] ?? null
  }
  return null
}

function isSectionHeader(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith("[") && trimmed.endsWith("]")
}
