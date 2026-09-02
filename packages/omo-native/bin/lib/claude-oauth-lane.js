import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

// Mirrors the pinned engine's claude-sdk-oauth lane resolution (auth.json slots,
// CLAUDE_CODE_OAUTH_TOKEN[_N] env slots, tokenInjection settings) so `omo doctor`
// can name the state that turns background calls into
// "Failed to authenticate: OAuth session expired and could not be refreshed".
// Read-only on purpose: doctor never mutates credential state.

const PROVIDER_ID = "claude-sdk-oauth"
const TOKEN_INJECTION_VALUES = new Set(["oauth-slots", "config-dir", "ambient"])
const ENV_TOKEN_SLOT_MAX = 16

function envTokenCount(env) {
  let count = 0
  if (env.CLAUDE_CODE_OAUTH_TOKEN) count += 1
  for (let index = 2; index <= ENV_TOKEN_SLOT_MAX; index += 1) {
    if (env[`CLAUDE_CODE_OAUTH_TOKEN_${index}`]) count += 1
  }
  return count
}

function parseEnabled(value) {
  if (typeof value !== "string") return undefined
  const normalized = value.toLowerCase()
  if (normalized === "1" || normalized === "true") return true
  if (normalized === "0" || normalized === "false") return false
  return undefined
}

function readProviderSettings(agentDir) {
  const settingsPath = join(agentDir, "settings.json")
  if (!existsSync(settingsPath)) return {}
  let settings
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"))
  } catch {
    return {}
  }
  const provider = settings?.claudeSdkOauthProvider
  return provider !== null && typeof provider === "object" ? provider : {}
}

function storedSlots(credential) {
  return Array.isArray(credential?.accounts) ? credential.accounts : []
}

function slotUnusable(slot, now) {
  if (slot?.blockReason === "auth_error") return true
  return typeof slot?.expires === "number" && slot.expires <= now
}

export function assessClaudeSdkOauthLane({ agentDir, env = {}, now = Date.now() }) {
  const authPath = join(agentDir, "auth.json")
  let credential
  if (existsSync(authPath)) {
    try {
      const parsed = JSON.parse(readFileSync(authPath, "utf8"))
      const candidate = parsed?.[PROVIDER_ID]
      if (candidate !== null && typeof candidate === "object") credential = candidate
    } catch (error) {
      // The store backs every provider, so an unreadable file is worth naming
      // even though the claude-sdk-oauth state cannot be determined from it.
      return { lines: [`WARN could not parse ${authPath}: ${error.message}`], failed: false }
    }
  }
  const envTokens = envTokenCount(env)
  if (!credential && envTokens === 0) return undefined

  const providerSettings = readProviderSettings(agentDir)
  const settingsEnabled = typeof providerSettings.enabled === "boolean" ? providerSettings.enabled : undefined
  if ((parseEnabled(env.SENPI_CLAUDE_SDK_OAUTH_ENABLED) ?? settingsEnabled) === false) {
    return { lines: ["PASS claude sdk oauth lane: disabled by configuration"], failed: false }
  }

  const envInjection = TOKEN_INJECTION_VALUES.has(env.SENPI_CLAUDE_SDK_OAUTH_TOKEN_INJECTION)
    ? env.SENPI_CLAUDE_SDK_OAUTH_TOKEN_INJECTION
    : undefined
  const settingInjection = TOKEN_INJECTION_VALUES.has(providerSettings.tokenInjection)
    ? providerSettings.tokenInjection
    : undefined
  if ((envInjection ?? settingInjection) === "ambient") {
    return { lines: ["PASS claude sdk oauth lane: ambient (the Claude CLI manages its own login)"], failed: false }
  }

  const accounts = storedSlots(credential)
  const total = accounts.length + envTokens
  if (total === 0) {
    return {
      lines: [
        "FAIL claude sdk oauth lane: saved login has no account slots; background calls fall back to the Claude CLI's own login and fail when that CLI is logged out; run omo, then /login claude-sdk-oauth, to refresh the saved login",
      ],
      failed: true,
    }
  }
  const unusable = accounts.filter((slot) => slotUnusable(slot, now)).length
  const usable = total - unusable
  if (usable === 0) {
    return {
      lines: [
        `FAIL claude sdk oauth lane: all ${total} account slot(s) are blocked or expired; auth blocks persist until re-login; run omo, then /login claude-sdk-oauth, to refresh`,
      ],
      failed: true,
    }
  }
  const suffix = unusable > 0 ? ` (${unusable} blocked or expired)` : ""
  return { lines: [`PASS claude sdk oauth lane: ${usable} account slot(s) available${suffix}`], failed: false }
}
