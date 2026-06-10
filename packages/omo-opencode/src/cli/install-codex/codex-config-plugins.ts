import { appendBlock, findTomlSection, replaceOrInsertSetting } from "./toml-section-editor"
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
  readonly gitBashEnabled?: boolean
}): string {
  if (input.marketplaceName !== "sisyphuslabs" || !input.pluginNames.includes("omo")) return config
  const gitBashEnabled = (input.platform ?? process.platform) === "win32" && input.gitBashEnabled === true
  let nextConfig = ensurePluginMcpEnabled(config, "omo@sisyphuslabs", "context7", true)
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
