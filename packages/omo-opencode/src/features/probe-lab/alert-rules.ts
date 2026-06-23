import type { ProbeMetrics } from "./metrics-formatter"

export type AlertSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL"

export type Alert = {
  rule: string
  severity: AlertSeverity
  message: string
  entity_id: string | null
  evaluated_at: number
}

export type AlertContext = {
  metrics: ProbeMetrics
  burn_rate_per_hour: ReadonlyArray<{ provider: string; identities_per_hour: number }>
  provider_consecutive_health_failures: ReadonlyArray<{ provider: string; failure_count: number }>
  canary_failures_recent: ReadonlyArray<{ identity_id: string; canary_failed: boolean }>
  credential_expiry_seconds: ReadonlyArray<{ provider: string; expires_in_s: number }>
  experiment_safety_breaches: ReadonlyArray<{ experiment_id: string; breached: boolean }>
  global_kill_switch_active: boolean
  evaluated_at?: number
}

export type AlertRule = (ctx: AlertContext) => Alert[]

const HEALTHY_RATIO_CRITICAL = 0.5
const HEALTHY_RATIO_WARNING = 0.8
const BURN_RATE_WARNING_PER_HOUR = 3
const PROVIDER_HEALTH_FAILURE_THRESHOLD = 3
const CIRCUIT_OPEN_RATIO_CRITICAL = 0.3
const CREDENTIAL_EXPIRY_WARNING_S = 3600

export function evaluateAlertRules(ctx: AlertContext): Alert[] {
  const at = ctx.evaluated_at ?? Math.floor(Date.now() / 1000)
  return [
    ...poolCriticalRule(ctx, at),
    ...poolDegradedRule(ctx, at),
    ...burnRateHighRule(ctx, at),
    ...providerDownRule(ctx, at),
    ...circuitCascadeRule(ctx, at),
    ...canaryFailureRule(ctx, at),
    ...credentialExpiryRule(ctx, at),
    ...experimentSafetyBreachRule(ctx, at),
    ...killSwitchRule(ctx, at),
  ]
}

function poolCriticalRule(ctx: AlertContext, at: number): Alert[] {
  return ctx.metrics.pool_healthy_ratio
    .filter((row) => row.value < HEALTHY_RATIO_CRITICAL)
    .map((row) => ({ rule: "pool_critical", severity: "CRITICAL" as const, message: `Pool healthy ratio for ${row.provider} dropped to ${row.value.toFixed(2)} (< ${HEALTHY_RATIO_CRITICAL}); auto-pause experiments`, entity_id: row.provider, evaluated_at: at }))
}

function poolDegradedRule(ctx: AlertContext, at: number): Alert[] {
  return ctx.metrics.pool_healthy_ratio
    .filter((row) => row.value < HEALTHY_RATIO_WARNING && row.value >= HEALTHY_RATIO_CRITICAL)
    .map((row) => ({ rule: "pool_degraded", severity: "WARNING" as const, message: `Pool healthy ratio for ${row.provider} = ${row.value.toFixed(2)} (< ${HEALTHY_RATIO_WARNING}); reduce probe rate`, entity_id: row.provider, evaluated_at: at }))
}

function burnRateHighRule(ctx: AlertContext, at: number): Alert[] {
  return ctx.burn_rate_per_hour
    .filter((row) => row.identities_per_hour > BURN_RATE_WARNING_PER_HOUR)
    .map((row) => ({ rule: "burn_rate_high", severity: "WARNING" as const, message: `Identity burn rate for ${row.provider} = ${row.identities_per_hour}/hour (> ${BURN_RATE_WARNING_PER_HOUR}); notify user`, entity_id: row.provider, evaluated_at: at }))
}

function providerDownRule(ctx: AlertContext, at: number): Alert[] {
  return ctx.provider_consecutive_health_failures
    .filter((row) => row.failure_count >= PROVIDER_HEALTH_FAILURE_THRESHOLD)
    .map((row) => ({ rule: "provider_down", severity: "CRITICAL" as const, message: `Provider ${row.provider} health check failed ${row.failure_count}x; quarantine provider`, entity_id: row.provider, evaluated_at: at }))
}

function circuitCascadeRule(ctx: AlertContext, at: number): Alert[] {
  const totalsByProvider = aggregateByProvider(ctx.metrics.pool_healthy_ratio.map((row) => row.provider))
  const out: Alert[] = []
  for (const open of ctx.metrics.circuit_breaker_open) {
    const ratio = computeOpenRatio(open.provider, open.value, totalsByProvider, ctx.metrics)
    if (ratio > CIRCUIT_OPEN_RATIO_CRITICAL) {
      out.push({ rule: "circuit_cascade", severity: "CRITICAL", message: `Circuit cascade for ${open.provider}: ${(ratio * 100).toFixed(0)}% open (> 30%); halt all probes`, entity_id: open.provider, evaluated_at: at })
    }
  }
  return out
}

function canaryFailureRule(ctx: AlertContext, at: number): Alert[] {
  return ctx.canary_failures_recent
    .filter((row) => row.canary_failed)
    .map((row) => ({ rule: "canary_failure", severity: "ERROR" as const, message: `Canary ${row.identity_id} test failed; escalate if no canaries remain`, entity_id: row.identity_id, evaluated_at: at }))
}

function credentialExpiryRule(ctx: AlertContext, at: number): Alert[] {
  return ctx.credential_expiry_seconds
    .filter((row) => row.expires_in_s < CREDENTIAL_EXPIRY_WARNING_S)
    .map((row) => ({ rule: "credential_expiry", severity: "WARNING" as const, message: `Credential for ${row.provider} expires in ${row.expires_in_s}s (< 1h); auto-refresh`, entity_id: row.provider, evaluated_at: at }))
}

function experimentSafetyBreachRule(ctx: AlertContext, at: number): Alert[] {
  return ctx.experiment_safety_breaches
    .filter((row) => row.breached)
    .map((row) => ({ rule: "experiment_safety_breach", severity: "ERROR" as const, message: `Experiment ${row.experiment_id} safety budget exceeded mid-run; abort`, entity_id: row.experiment_id, evaluated_at: at }))
}

function killSwitchRule(ctx: AlertContext, at: number): Alert[] {
  if (!ctx.global_kill_switch_active) return []
  return [{ rule: "kill_switch_active", severity: "INFO", message: "Global kill switch is active; probe_run and probe_replay are blocked", entity_id: null, evaluated_at: at }]
}

function aggregateByProvider(providers: ReadonlyArray<string>): Map<string, number> {
  const result = new Map<string, number>()
  for (const provider of providers) result.set(provider, (result.get(provider) ?? 0) + 1)
  return result
}

function computeOpenRatio(provider: string, openCount: number, _totals: Map<string, number>, metrics: ProbeMetrics): number {
  const ratio = metrics.pool_healthy_ratio.find((row) => row.provider === provider)
  if (!ratio) return openCount > 0 ? 1 : 0
  const denominator = ratio.value > 0 ? Math.max(1, openCount + 1) : Math.max(1, openCount)
  return openCount / denominator
}
