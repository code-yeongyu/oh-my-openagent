export type ProbeMetrics = {
  exchanges_total: Array<{ provider: string; status: string; outcome: string; count: number }>
  duration_quantiles: Array<{ provider: string; method: string; quantile: number; value: number }>
  pool_healthy_ratio: Array<{ provider: string; value: number }>
  hypothesis_count: Array<{ status: string; count: number }>
  circuit_breaker_open: Array<{ provider: string; value: number }>
  identity_burn_rate: Array<{ provider: string; value: number }>
}

export type MetricsFormat = "prometheus" | "json"

export function formatProbeMetrics(metrics: ProbeMetrics, format: MetricsFormat): string {
  if (format === "json") return JSON.stringify(metrics)
  return [
    ...metricHeader("probe_exchanges_total", "counter", "Probe exchanges by provider, status, and outcome"),
    ...metrics.exchanges_total.map((row) => `probe_exchanges_total${labels({ provider: row.provider, status: row.status, outcome: row.outcome })} ${row.count}`),
    ...metricHeader("probe_exchange_duration_ms", "gauge", "Probe exchange duration quantiles in milliseconds"),
    ...metrics.duration_quantiles.map((row) => `probe_exchange_duration_ms${labels({ provider: row.provider, method: row.method, quantile: String(row.quantile) })} ${row.value}`),
    ...metricHeader("probe_pool_healthy_ratio", "gauge", "Active identities divided by total identities"),
    ...metrics.pool_healthy_ratio.map((row) => `probe_pool_healthy_ratio${labels({ provider: row.provider })} ${row.value}`),
    ...metricHeader("probe_hypothesis_count", "gauge", "Hypothesis count by status"),
    ...metrics.hypothesis_count.map((row) => `probe_hypothesis_count${labels({ status: row.status })} ${row.count}`),
    ...metricHeader("probe_circuit_breaker_open", "gauge", "Open circuit breaker count by provider"),
    ...metrics.circuit_breaker_open.map((row) => `probe_circuit_breaker_open${labels({ provider: row.provider })} ${row.value}`),
    ...metricHeader("probe_identity_burn_rate", "gauge", "Identity quarantine count over the last 24 hours"),
    ...metrics.identity_burn_rate.map((row) => `probe_identity_burn_rate${labels({ provider: row.provider })} ${row.value}`),
  ].join("\n")
}

function metricHeader(name: string, type: string, help: string): string[] {
  return [`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`]
}

function labels(values: Record<string, string>): string {
  return `{${Object.entries(values).map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(",")}}`
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, "\\n")
}
