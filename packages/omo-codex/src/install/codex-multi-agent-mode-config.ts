import { isTomlTableHeaderLine } from "./toml-section-editor"

const CODEX_MULTI_AGENT_MODE_KEY = "multi_agent_mode"

export function removeUnsupportedCodexMultiAgentModeConfig(config: string): string {
  const lines = config.split(/\n/)
  const output: string[] = []
  let inRoot = true
  let changed = false
  for (const line of lines) {
    const sectionHeader = isSectionHeader(line)
    if (inRoot && isRootSetting(line, CODEX_MULTI_AGENT_MODE_KEY)) {
      changed = true
      continue
    }
    output.push(line)
    if (sectionHeader) inRoot = false
  }
  return changed ? output.join("\n") : config
}

function isSectionHeader(line: string): boolean {
  return isTomlTableHeaderLine(line)
}

function isRootSetting(line: string, key: string): boolean {
  const trimmed = line.trimStart()
  if (trimmed.startsWith("#") || trimmed.startsWith("[")) return false
  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/)
  return match?.[1] === key
}
