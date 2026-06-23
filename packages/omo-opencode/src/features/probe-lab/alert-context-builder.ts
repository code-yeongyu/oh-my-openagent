import type { ProbeStore } from "./sqlite-store"
import type { AlertContext } from "./alert-rules"

const ONE_DAY_S = 86_400
const ONE_HOUR_S = 3_600
const PROVIDER_HEALTH_THRESHOLD = 3

export type AlertContextDependencies = {
  store: ProbeStore
  globalKillSwitchActive: boolean
  now?: () => number
}

export function buildAlertContext(deps: AlertContextDependencies): AlertContext {
  const now = (deps.now ?? (() => Math.floor(Date.now() / 1000)))()
  const metrics = deps.store.collectProbeMetrics()
  return {
    metrics,
    burn_rate_per_hour: metrics.identity_burn_rate.map((row) => ({
      provider: row.provider,
      identities_per_hour: row.value / 24,
    })),
    provider_consecutive_health_failures: collectProviderHealthFailures(deps.store, now),
    canary_failures_recent: collectRecentCanaryFailures(deps.store, now),
    credential_expiry_seconds: collectCredentialExpiries(deps.store, now),
    experiment_safety_breaches: collectExperimentSafetyBreaches(deps.store, now),
    global_kill_switch_active: deps.globalKillSwitchActive,
    evaluated_at: now,
  }
}

function collectProviderHealthFailures(
  store: ProbeStore,
  now: number,
): Array<{ provider: string; failure_count: number }> {
  const since = now - ONE_DAY_S
  const buckets = new Map<string, number>()
  const page = store.listAuditLog({ entity_type: "provider", since, limit: 500, offset: 0 })
  for (const entry of page.entries) {
    if (!entry.action.includes("health_fail")) continue
    buckets.set(entry.entity_id, (buckets.get(entry.entity_id) ?? 0) + 1)
  }
  const out: Array<{ provider: string; failure_count: number }> = []
  for (const [provider, failureCount] of buckets) {
    if (failureCount >= PROVIDER_HEALTH_THRESHOLD) out.push({ provider, failure_count: failureCount })
  }
  return out
}

function collectRecentCanaryFailures(
  store: ProbeStore,
  now: number,
): Array<{ identity_id: string; canary_failed: boolean }> {
  const cutoff = now - ONE_HOUR_S
  return store.listActiveCanaryLocks()
    .filter((lock) => lock.last_canary_result === "fail" && (lock.last_canary_test_at ?? 0) >= cutoff)
    .map((lock) => ({ identity_id: lock.identity_id, canary_failed: true }))
}

function collectCredentialExpiries(
  store: ProbeStore,
  now: number,
): Array<{ provider: string; expires_in_s: number }> {
  const cutoff = now + ONE_HOUR_S
  const out: Array<{ provider: string; expires_in_s: number }> = []
  for (const provider of store.listProviders()) {
    const expiresAt = readProviderExpiresAt(provider.auth_config)
    if (expiresAt == null || expiresAt > cutoff) continue
    out.push({ provider: provider.id, expires_in_s: Math.max(0, expiresAt - now) })
  }
  return out
}

function readProviderExpiresAt(authConfigJson: string): number | null {
  try {
    const parsed: unknown = JSON.parse(authConfigJson)
    if (!parsed || typeof parsed !== "object") return null
    const expiresAt = (parsed as Record<string, unknown>).expires_at
    if (typeof expiresAt === "number" && Number.isFinite(expiresAt)) return expiresAt
    if (typeof expiresAt === "string") {
      const numeric = Number(expiresAt)
      return Number.isFinite(numeric) ? numeric : null
    }
    return null
  } catch {
    return null
  }
}

function collectExperimentSafetyBreaches(
  store: ProbeStore,
  now: number,
): Array<{ experiment_id: string; breached: boolean }> {
  const since = now - ONE_DAY_S
  const seen = new Set<string>()
  const out: Array<{ experiment_id: string; breached: boolean }> = []
  const page = store.listAuditLog({ entity_type: "experiment", action: "abort_safety", since, limit: 500, offset: 0 })
  for (const entry of page.entries) {
    if (seen.has(entry.entity_id)) continue
    seen.add(entry.entity_id)
    out.push({ experiment_id: entry.entity_id, breached: true })
  }
  return out
}
