import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { ensureContext7McpServer } from "./codex-config-mcp"
import { ensureAutonomousPermissions } from "./codex-config-permissions"
import { ensureCodexMultiAgentV2Config } from "./codex-multi-agent-v2-config"
import { appendBlock, findTomlSection, replaceOrInsertSetting } from "./toml-section-editor"
import type { CodexAgentConfig, CodexInstallPlatform, CodexMarketplaceSource, TrustedHookState } from "./types"

const SISYPHUS_LEGACY_MARKETPLACES = ["lazycodex", "code-yeongyu-codex-plugins"] as const
const MANAGED_CODEX_AGENT_NAMES = [
  "codex-ultrawork-reviewer",
  "explorer",
  "librarian",
  "metis",
  "momus",
  "plan",
] as const

export async function updateCodexConfig(input: {
  readonly configPath: string
  readonly repoRoot: string
  readonly marketplaceName: string
  readonly marketplaceSource: CodexMarketplaceSource
  readonly pluginNames: readonly string[]
  readonly platform?: CodexInstallPlatform
  readonly trustedHookStates?: readonly TrustedHookState[]
  readonly agentConfigs?: readonly CodexAgentConfig[]
  readonly autonomousPermissions?: boolean
}): Promise<void> {
  await mkdir(dirname(input.configPath), { recursive: true })
  let config = ""
  if (await exists(input.configPath)) config = await readFile(input.configPath, "utf8")

  const pluginSet = new Set(input.pluginNames)
  for (const legacyMarketplaceName of legacyMarketplaceNames(input.marketplaceName)) {
    config = removeMarketplaceBlock(config, legacyMarketplaceName)
    config = removeStaleMarketplacePluginBlocks(config, legacyMarketplaceName, new Set())
    config = removeStaleMarketplaceHookStateBlocks(config, legacyMarketplaceName, new Set())
  }
  config = removeStaleMarketplacePluginBlocks(config, input.marketplaceName, pluginSet)
  config = removeStaleMarketplaceHookStateBlocks(config, input.marketplaceName, pluginSet)
  config = removeStaleManagedAgentBlocks(
    config,
    new Set((input.agentConfigs ?? []).map((agentConfig) => agentConfig.name)),
  )
  config = ensureFeatureEnabled(config, "plugins")
  config = ensureFeatureEnabled(config, "plugin_hooks")
  config = ensureCodexMultiAgentV2Config(config)
  config = ensureContext7McpServer(config)
  if (input.autonomousPermissions === true) config = ensureAutonomousPermissions(config)
  config = ensureMarketplaceBlock(config, input.marketplaceName, input.marketplaceSource)
  for (const pluginName of input.pluginNames) {
    config = ensurePluginEnabled(config, `${pluginName}@${input.marketplaceName}`)
  }
  config = ensureOmoGitBashMcpPolicy(config, input)
  for (const state of input.trustedHookStates ?? []) {
    config = ensureHookTrusted(config, state.key, state.trustedHash)
  }
  for (const agentConfig of input.agentConfigs ?? []) {
    config = ensureAgentConfig(config, agentConfig)
  }

  await writeFile(input.configPath, `${config.trimEnd()}\n`)
}

function legacyMarketplaceNames(marketplaceName: string): readonly string[] {
  return marketplaceName === "sisyphuslabs" ? SISYPHUS_LEGACY_MARKETPLACES : []
}

function removeMarketplaceBlock(config: string, marketplaceName: string): string {
  return removeTomlSections(config, (header) => header === `marketplaces.${marketplaceName}`)
}

function removeStaleMarketplacePluginBlocks(config: string, marketplaceName: string, keepPluginNames: Set<string>): string {
  return removeTomlSections(config, (header) => {
    const pluginKey = parsePluginHeaderKey(header)
    if (pluginKey === null) return false
    const suffix = `@${marketplaceName}`
    if (!pluginKey.endsWith(suffix)) return false
    return !keepPluginNames.has(pluginKey.slice(0, -suffix.length))
  })
}

function removeStaleMarketplaceHookStateBlocks(config: string, marketplaceName: string, keepPluginNames: Set<string>): string {
  return removeTomlSections(config, (header) => {
    const prefix = "hooks.state."
    if (!header.startsWith(prefix)) return false
    const hookKey = parseJsonString(header.slice(prefix.length))
    if (hookKey === null) return false
    const separator = hookKey.indexOf(":")
    if (separator === -1) return false
    const pluginKey = hookKey.slice(0, separator)
    const suffix = `@${marketplaceName}`
    if (!pluginKey.endsWith(suffix)) return false
    return !keepPluginNames.has(pluginKey.slice(0, -suffix.length))
  })
}

function removeStaleManagedAgentBlocks(config: string, keepAgentNames: Set<string>): string {
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

function ensureFeatureEnabled(config: string, featureName: string): string {
  const section = findTomlSection(config, "features")
  if (!section) return appendBlock(config, `[features]\n${featureName} = true\n`)
  return replaceOrInsertSetting(config, section, featureName, "true")
}

function ensureMarketplaceBlock(config: string, marketplaceName: string, source: CodexMarketplaceSource): string {
  const header = `marketplaces.${marketplaceName}`
  const lines = [
    `[${header}]`,
    `last_updated = "${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}"`,
    `source_type = ${JSON.stringify(source.sourceType)}`,
    `source = ${JSON.stringify(source.source)}`,
  ]
  if (source.sourceType === "git") {
    lines.push(`ref = ${JSON.stringify(source.ref)}`)
  }
  lines.push("")
  const block = lines.join("\n")
  const section = findTomlSection(config, header)
  if (section) return config.slice(0, section.start) + block + config.slice(section.end)
  return appendBlock(
    config,
    block,
  )
}

function ensurePluginEnabled(config: string, pluginKey: string): string {
  const header = `plugins.${JSON.stringify(pluginKey)}`
  const section = findTomlSection(config, header)
  if (!section) return appendBlock(config, `[${header}]\nenabled = true\n`)
  return replaceOrInsertSetting(config, section, "enabled", "true")
}

function ensurePluginMcpEnabled(config: string, pluginKey: string, serverName: string, enabled: boolean): string {
  const header = `plugins.${JSON.stringify(pluginKey)}.mcp_servers.${serverName}`
  const section = findTomlSection(config, header)
  const enabledValue = enabled ? "true" : "false"
  if (!section) return appendBlock(config, `[${header}]\nenabled = ${enabledValue}\n`)
  return replaceOrInsertSetting(config, section, "enabled", enabledValue)
}

function ensureOmoGitBashMcpPolicy(config: string, input: {
  readonly marketplaceName: string
  readonly pluginNames: readonly string[]
  readonly platform?: CodexInstallPlatform
}): string {
  if (input.marketplaceName !== "sisyphuslabs" || !input.pluginNames.includes("omo")) return config
  const enabled = (input.platform ?? process.platform) === "win32"
  return ensurePluginMcpEnabled(config, "omo@sisyphuslabs", "git_bash", enabled)
}

function ensureHookTrusted(config: string, key: string, trustedHash: string): string {
  const header = `hooks.state.${JSON.stringify(key)}`
  const section = findTomlSection(config, header)
  if (!section) return appendBlock(config, `[${header}]\ntrusted_hash = ${JSON.stringify(trustedHash)}\n`)
  return replaceOrInsertSetting(config, section, "trusted_hash", JSON.stringify(trustedHash))
}

function ensureAgentConfig(config: string, agentConfig: CodexAgentConfig): string {
  const header = `agents.${tomlKeySegment(agentConfig.name)}`
  const section = findTomlSection(config, header)
  const configFile = JSON.stringify(agentConfig.configFile)
  if (!section) return appendBlock(config, `[${header}]\nconfig_file = ${configFile}\n`)
  return replaceOrInsertSetting(config, section, "config_file", configFile)
}

function tomlKeySegment(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : JSON.stringify(value)
}

function removeTomlSections(config: string, shouldRemove: (header: string) => boolean): string {
  return splitTomlSections(config)
    .filter((section) => section.header === null || !shouldRemove(section.header))
    .map((section) => section.text)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
}

function splitTomlSections(config: string): Array<{ header: string | null; text: string }> {
  const lines = config.match(/[^\n]*\n?|$/g) ?? []
  const sections: Array<{ header: string | null; text: string }> = []
  let current: { header: string | null; text: string } = { header: null, text: "" }
  for (const line of lines) {
    if (line.length === 0) break
    const header = parseTomlHeader(line)
    if (header !== null) {
      if (current.text.length > 0) sections.push(current)
      current = { header, text: line }
    } else {
      current.text += line
    }
  }
  if (current.text.length > 0) sections.push(current)
  return sections
}

function parseTomlHeader(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]") || trimmed.startsWith("[[")) return null
  return trimmed.slice(1, -1)
}

function parsePluginHeaderKey(header: string): string | null {
  const prefix = "plugins."
  if (!header.startsWith(prefix)) return null
  return parseLeadingJsonString(header.slice(prefix.length))
}

function parseAgentHeaderName(header: string): string | null {
  const prefix = "agents."
  if (!header.startsWith(prefix)) return null
  const key = header.slice(prefix.length)
  return key.startsWith('"') ? parseLeadingJsonString(key) : key
}

function parseLeadingJsonString(value: string): string | null {
  if (!value.startsWith('"')) return parseJsonString(value)
  let escaped = false
  for (let index = 1; index < value.length; index += 1) {
    const char = value[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === "\\") {
      escaped = true
      continue
    }
    if (char === '"') return parseJsonString(value.slice(0, index + 1))
  }
  return null
}

function parseJsonString(value: string): string | null {
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === "string" ? parsed : null
  } catch (error) {
    if (error instanceof Error) return null
    return null
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path, "utf8")
    return true
  } catch (error) {
    if (error instanceof Error) return false
    return false
  }
}
