import { appendBlock, findTomlSection, replaceOrInsertSetting } from "./toml-section-editor"
import { parseAgentHeaderName, splitTomlSections } from "./codex-config-toml-sections"
import type { CodexAgentConfig } from "./types"

const LEGACY_MANAGED_CODEX_AGENT_NAMES_TO_PURGE = ["codex-ultrawork-reviewer"] as const

const CURRENT_MANAGED_CODEX_AGENT_NAMES = [
  "explorer",
  "librarian",
  "metis",
  "momus",
  "plan",
] as const

const MANAGED_CODEX_AGENT_NAMES = [
  ...LEGACY_MANAGED_CODEX_AGENT_NAMES_TO_PURGE,
  ...CURRENT_MANAGED_CODEX_AGENT_NAMES,
] as const

export function removeStaleManagedAgentBlocks(config: string, keepAgentNames: Set<string>): string {
  const managedAgentNames = new Set<string>(MANAGED_CODEX_AGENT_NAMES)
  return splitTomlSections(config)
    .filter((section) => {
      if (section.header === null) return true
      const agentName = parseAgentHeaderName(section.header)
      if (agentName === null || !managedAgentNames.has(agentName) || keepAgentNames.has(agentName)) return true
      return !section.text.includes(`config_file = ${JSON.stringify(`./agents/${agentName}.toml`)}`)
    })
    .map((section) => section.text)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
}

export function ensureAgentConfig(config: string, agentConfig: CodexAgentConfig): string {
  const header = `agents.${tomlKeySegment(agentConfig.name)}`
  const section = findTomlSection(config, header)
  const configFile = JSON.stringify(agentConfig.configFile)
  if (!section) return appendBlock(config, `[${header}]\nconfig_file = ${configFile}\n`)
  return replaceOrInsertSetting(config, section, "config_file", configFile)
}

function tomlKeySegment(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : JSON.stringify(value)
}
