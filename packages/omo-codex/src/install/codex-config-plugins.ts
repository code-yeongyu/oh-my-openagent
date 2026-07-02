import { appendBlock, findTomlSection, replaceOrInsertSetting } from "./toml-section-editor"
import { removeTomlSections } from "./codex-config-toml-sections"
import type { CodexInstallPlatform, TrustedHookState } from "./types"

export function ensurePluginEnabled(config: string, pluginKey: string): string {
  const header = `plugins.${JSON.stringify(pluginKey)}`
  const section = findTomlSection(config, header)
  if (!section) return appendBlock(config, `[${header}]\nenabled = true\n`)
  return replaceOrInsertSetting(config, section, "enabled", "true")
}

export function ensureOmoBuiltinMcpPolicies(config: string, input: {
  readonly marketplaceName: string
  readonly pluginNames: readonly string[]
  readonly platform?: CodexInstallPlatform
  readonly codegraphMcpEnabled?: boolean
  readonly gitBashEnabled?: boolean
}): string {
  if (input.marketplaceName !== "sisyphuslabs" || !input.pluginNames.includes("omo")) return config
  const codegraphEnabled = input.codegraphMcpEnabled ?? true
  const gitBashEnabled = (input.platform ?? process.platform) === "win32" && input.gitBashEnabled === true
  let nextConfig = removeStaleContext7PlaceholderMcp(config)
  nextConfig = ensurePluginMcpEnabled(nextConfig, "omo@sisyphuslabs", "context7", true)
  nextConfig = ensurePluginMcpEnabled(nextConfig, "omo@sisyphuslabs", "codegraph", codegraphEnabled)
  nextConfig = ensurePluginMcpEnabled(nextConfig, "omo@sisyphuslabs", "git_bash", gitBashEnabled)
  return nextConfig
}

export function ensureHookTrusted(config: string, state: TrustedHookState): string {
  const header = `hooks.state.${JSON.stringify(state.key)}`
  const section = findTomlSection(config, header)
  if (!section) return appendBlock(config, `[${header}]\ntrusted_hash = ${JSON.stringify(state.trustedHash)}\n`)
  return replaceOrInsertSetting(config, section, "trusted_hash", JSON.stringify(state.trustedHash))
}

function ensurePluginMcpEnabled(config: string, pluginKey: string, serverName: string, enabled: boolean): string {
  const header = `plugins.${JSON.stringify(pluginKey)}.mcp_servers.${serverName}`
  const section = findTomlSection(config, header)
  const enabledValue = enabled ? "true" : "false"
  if (!section) return appendBlock(config, `[${header}]\nenabled = ${enabledValue}\n`)
  return replaceOrInsertSetting(config, section, "enabled", enabledValue)
}

function removeStaleContext7PlaceholderMcp(config: string): string {
  return removeTomlSections(
    config,
    (header, section) => header === "mcp_servers.context7" && isContext7PlaceholderSection(section.text),
  )
}

function isContext7PlaceholderSection(sectionText: string): boolean {
  const args = readStringArraySetting(sectionText, "args")
  if (args === null || !args.includes("@upstash/context7-mcp")) return false
  const apiKey = valueAfter(args, "--api-key")
  return apiKey !== null && isPlaceholderApiKey(apiKey)
}

function valueAfter(values: readonly string[], key: string): string | null {
  const index = values.indexOf(key)
  return index >= 0 ? (values[index + 1] ?? null) : null
}

function isPlaceholderApiKey(value: string): boolean {
  return /^your[-_ ]?api[-_ ]?key$/i.test(value)
}

function readStringArraySetting(sectionText: string, key: string): readonly string[] | null {
  for (const line of sectionText.split("\n")) {
    if (!new RegExp(`^\\s*${key}\\s*=`).test(line)) continue
    const assignmentIndex = line.indexOf("=")
    if (assignmentIndex === -1) return null
    return parseTomlStringArray(stripUnquotedInlineComment(line.slice(assignmentIndex + 1)).trim())
  }
  return null
}

function parseTomlStringArray(value: string): readonly string[] | null {
  if (!value.startsWith("[") || !value.endsWith("]")) return null
  const items: string[] = []
  let index = 1
  while (index < value.length - 1) {
    const char = value[index]
    if (char === '"' || char === "'") {
      const parsed = parseTomlString(value, index)
      if (parsed === null) return null
      items.push(parsed.value)
      index = parsed.nextIndex
      continue
    }
    index += 1
  }
  return items
}

function parseTomlString(input: string, startIndex: number): { readonly value: string; readonly nextIndex: number } | null {
  const quote = input[startIndex]
  let value = ""
  let index = startIndex + 1
  while (index < input.length) {
    const char = input[index]
    if (quote === '"' && char === "\\") {
      const next = input[index + 1]
      if (next === undefined) return null
      value += next
      index += 2
      continue
    }
    if (char === quote) return { value, nextIndex: index + 1 }
    value += char
    index += 1
  }
  return null
}

function stripUnquotedInlineComment(line: string): string {
  let quote: string | null = null
  let index = 0
  while (index < line.length) {
    const char = line[index]
    if (quote === '"') {
      if (char === "\\") {
        index += 2
        continue
      }
      if (char === '"') quote = null
      index += 1
      continue
    }
    if (quote === "'") {
      if (char === "'") quote = null
      index += 1
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      index += 1
      continue
    }
    if (char === "#") return line.slice(0, index)
    index += 1
  }
  return line
}
