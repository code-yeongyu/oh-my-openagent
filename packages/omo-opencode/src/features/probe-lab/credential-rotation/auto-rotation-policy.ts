import type { ProbeStore } from "../sqlite-store"

const EXPIRY_THRESHOLD_S = 3_600
const CONSECUTIVE_AUTH_FAILURE_THRESHOLD = 5
const AUTH_FAILURE_LOOKBACK_S = 86_400

export type AutoRotationAction = "rotate" | "refresh"
export type AutoRotationRotationType = "api_key" | "proxy" | "fingerprint"
export type AutoRotationRefreshType = "aws_waf_token" | "cookies" | "token" | "credentials" | "models" | "all"

export type AutoRotationTrigger = {
  provider_id: string
  action: AutoRotationAction
  rotation_type?: AutoRotationRotationType
  refresh_type?: AutoRotationRefreshType
  reason: string
}

export type AutoRotationDeps = {
  store: ProbeStore
  now?: () => number
}

export function evaluateAutoRotationTriggers(deps: AutoRotationDeps): AutoRotationTrigger[] {
  const now = (deps.now ?? (() => Math.floor(Date.now() / 1000)))()
  const triggers: AutoRotationTrigger[] = []
  for (const provider of deps.store.listProviders()) {
    const expires = readExpiresAt(provider.auth_config)
    if (expires != null && expires <= now + EXPIRY_THRESHOLD_S) {
      triggers.push(buildExpiryTrigger(provider.id, provider.provider_type, expires, now))
      continue
    }
    const consecutive401 = countRecentConsecutiveAuthFailures(deps.store, provider.id, now)
    if (consecutive401 >= CONSECUTIVE_AUTH_FAILURE_THRESHOLD) {
      triggers.push({
        provider_id: provider.id,
        action: "rotate",
        rotation_type: "api_key",
        reason: `auto: ${consecutive401} consecutive 401s in last 24h`,
      })
    }
  }
  return triggers
}

function buildExpiryTrigger(providerId: string, providerType: string, expires: number, now: number): AutoRotationTrigger {
  const reason = `auto: credential expires in <= ${EXPIRY_THRESHOLD_S}s (expires_at=${expires}, now=${now})`
  if (providerType === "deepseek_web") {
    return { provider_id: providerId, action: "refresh", refresh_type: "aws_waf_token", reason }
  }
  return { provider_id: providerId, action: "rotate", rotation_type: "api_key", reason }
}

function readExpiresAt(authConfigJson: string): number | null {
  try {
    const parsed: unknown = JSON.parse(authConfigJson)
    if (!parsed || typeof parsed !== "object") return null
    const value = (parsed as Record<string, unknown>).expires_at
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string") {
      const numeric = Number(value)
      return Number.isFinite(numeric) ? numeric : null
    }
    return null
  } catch { return null }
}

function countRecentConsecutiveAuthFailures(store: ProbeStore, providerId: string, now: number): number {
  const since = now - AUTH_FAILURE_LOOKBACK_S
  const page = store.listAuditLog({ entity_type: "provider", entity_id: providerId, since, limit: 100, offset: 0 })
  let consecutive = 0
  for (const entry of page.entries) {
    if (entry.action === "auth_fail" || entry.action === "401_response") consecutive += 1
    else break
  }
  return consecutive
}
