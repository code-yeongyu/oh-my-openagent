import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { CheckResult, CheckDefinition, AuthProviderInfo, AuthProviderId } from "../types"
import { CHECK_IDS, CHECK_NAMES } from "../constants"
import { parseJsonc, getOpenCodeConfigDir } from "../../../shared"

const OPENCODE_CONFIG_DIR = getOpenCodeConfigDir({ binary: "opencode" })
const OPENCODE_JSON = join(OPENCODE_CONFIG_DIR, "opencode.json")
const OPENCODE_JSONC = join(OPENCODE_CONFIG_DIR, "opencode.jsonc")

const AUTH_PLUGINS: Record<AuthProviderId, { plugin: string; name: string }> = {
  anthropic: { plugin: "builtin", name: "Anthropic (Claude)" },
  openai: { plugin: "opencode-openai-codex-auth", name: "OpenAI (ChatGPT)" },
  google: { plugin: "opencode-antigravity-auth", name: "Google (Gemini)" },
}

function getOpenCodeConfig(): { plugin?: string[] } | null {
  const configPath = existsSync(OPENCODE_JSONC) ? OPENCODE_JSONC : OPENCODE_JSON
  if (!existsSync(configPath)) return null

  try {
    const content = readFileSync(configPath, "utf-8")
    return parseJsonc<{ plugin?: string[] }>(content)
  } catch {
    return null
  }
}

function isPluginInstalled(plugins: string[], pluginName: string): boolean {
  if (pluginName === "builtin") return true
  return plugins.some((p) => p === pluginName || p.startsWith(`${pluginName}@`))
}

export function getAuthProviderInfo(providerId: AuthProviderId): AuthProviderInfo {
  const config = getOpenCodeConfig()
  const plugins = config?.plugin ?? []
  const authConfig = AUTH_PLUGINS[providerId]

  const pluginInstalled = isPluginInstalled(plugins, authConfig.plugin)

  return {
    id: providerId,
    name: authConfig.name,
    pluginInstalled,
    configured: pluginInstalled,
  }
}

export async function checkAuthProvider(providerId: AuthProviderId): Promise<CheckResult> {
  const info = getAuthProviderInfo(providerId)
  const checkId = `auth-${providerId}` as keyof typeof CHECK_NAMES
  const checkName = CHECK_NAMES[checkId] || info.name

  if (!info.pluginInstalled) {
    return {
      name: checkName,
      status: "skip",
      message: "Auth plugin not installed",
      details: [
        `Plugin: ${AUTH_PLUGINS[providerId].plugin}`,
        "Run: bunx oh-my-opencode install",
      ],
    }
  }

  return {
    name: checkName,
    status: "pass",
    message: "Auth plugin available",
    details: [
      providerId === "anthropic"
        ? "Run: opencode auth login (select Anthropic)"
        : `Plugin: ${AUTH_PLUGINS[providerId].plugin}`,
    ],
  }
}

export async function checkAnthropicAuth(): Promise<CheckResult> {
  return checkAuthProvider("anthropic")
}

export async function checkOpenAIAuth(): Promise<CheckResult> {
  return checkAuthProvider("openai")
}

export async function checkGoogleAuth(): Promise<CheckResult> {
  return checkAuthProvider("google")
}

export function getAuthCheckDefinitions(): CheckDefinition[] {
  return [
    {
      id: CHECK_IDS.AUTH_ANTHROPIC,
      name: CHECK_NAMES[CHECK_IDS.AUTH_ANTHROPIC],
      category: "authentication",
      check: checkAnthropicAuth,
      critical: false,
    },
    {
      id: CHECK_IDS.AUTH_OPENAI,
      name: CHECK_NAMES[CHECK_IDS.AUTH_OPENAI],
      category: "authentication",
      check: checkOpenAIAuth,
      critical: false,
    },
    {
      id: CHECK_IDS.AUTH_GOOGLE,
      name: CHECK_NAMES[CHECK_IDS.AUTH_GOOGLE],
      category: "authentication",
      check: checkGoogleAuth,
      critical: false,
    },
  ]
}
