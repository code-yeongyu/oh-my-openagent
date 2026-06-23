import type { Database } from "bun:sqlite"
import type { ProbeMetrics } from "../metrics-formatter"

type DurationRow = { provider: string | null; method: string; timing_total_ms: number | null }

export type MetricsStore = ReturnType<typeof createMetricsStore>

export function createMetricsStore(db: Database) {
  function collect(): ProbeMetrics {
    return {
      exchanges_total: exchangeTotals(),
      duration_quantiles: durationQuantiles(),
      pool_healthy_ratio: poolHealthyRatio(),
      hypothesis_count: hypothesisCount(),
      circuit_breaker_open: circuitBreakerOpen(),
      identity_burn_rate: identityBurnRate(),
    }
  }

  function exchangeTotals() {
    return db.query<{ provider: string | null; status_label: string | null; outcome: string; count: number }, []>(
      `SELECT COALESCE(pc.name, ps.provider_id, 'raw') AS provider,
              COALESCE(CAST(pe.response_status AS TEXT), 'null') AS status_label,
              CASE WHEN pe.response_status BETWEEN 200 AND 399 THEN 'success' ELSE 'error' END AS outcome,
              COUNT(*) AS count
       FROM probe_exchanges pe
       JOIN probe_sessions ps ON ps.id = pe.session_id
       LEFT JOIN provider_credentials pc ON pc.id = ps.provider_id
       GROUP BY provider, status_label, outcome`,
    ).all().map((row) => ({ provider: row.provider ?? "raw", status: row.status_label ?? "null", outcome: row.outcome, count: row.count }))
  }

  function durationQuantiles() {
    const rows = db.query<DurationRow, []>(
      `SELECT COALESCE(pc.name, ps.provider_id, 'raw') AS provider, pe.method, pe.timing_total_ms
       FROM probe_exchanges pe
       JOIN probe_sessions ps ON ps.id = pe.session_id
       LEFT JOIN provider_credentials pc ON pc.id = ps.provider_id
       WHERE pe.timing_total_ms IS NOT NULL`,
    ).all()
    return groupedDurations(rows).flatMap(([key, values]) => {
      const [provider, method] = key.split("\u0000")
      return [0.5, 0.9, 0.99].map((quantile) => ({ provider, method, quantile, value: quantileValue(values, quantile) }))
    })
  }

  function poolHealthyRatio() {
    return db.query<{ provider: string | null; total: number; active: number }, []>(
      `SELECT COALESCE(provider_id, 'raw') AS provider, COUNT(*) AS total,
              SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active
       FROM identities GROUP BY provider`,
    ).all().map((row) => ({ provider: row.provider ?? "raw", value: row.total > 0 ? (row.active ?? 0) / row.total : 0 }))
  }

  function hypothesisCount() {
    return db.query<{ status: string; count: number }, []>(
      "SELECT status, COUNT(*) AS count FROM hypotheses GROUP BY status",
    ).all()
  }

  function circuitBreakerOpen() {
    return db.query<{ provider: string | null; value: number }, []>(
      `SELECT COALESCE(provider_id, 'raw') AS provider,
              SUM(CASE WHEN circuit_state = 'open' THEN 1 ELSE 0 END) AS value
       FROM identities GROUP BY provider`,
    ).all().map((row) => ({ provider: row.provider ?? "raw", value: row.value ?? 0 }))
  }

  function identityBurnRate() {
    const since = Math.floor(Date.now() / 1000) - 86400
    return db.query<{ provider: string | null; value: number }, [number]>(
      `SELECT COALESCE(i.provider_id, 'raw') AS provider, COUNT(*) AS value
       FROM audit_log a LEFT JOIN identities i ON i.id = a.entity_id
       WHERE a.action = 'quarantine' AND a.created_at >= ?1 GROUP BY provider`,
    ).all(since).map((row) => ({ provider: row.provider ?? "raw", value: row.value }))
  }

  return { collect }
}

function groupedDurations(rows: DurationRow[]): Array<[string, number[]]> {
  const groups = new Map<string, number[]>()
  for (const row of rows) {
    const key = `${row.provider ?? "raw"}\u0000${row.method}`
    groups.set(key, [...(groups.get(key) ?? []), row.timing_total_ms ?? 0])
  }
  return Array.from(groups.entries()).map(([key, values]) => [key, values.sort((a, b) => a - b)])
}

function quantileValue(values: number[], quantile: number): number {
  if (values.length === 0) return 0
  return values[Math.floor((values.length - 1) * quantile)] ?? 0
}
