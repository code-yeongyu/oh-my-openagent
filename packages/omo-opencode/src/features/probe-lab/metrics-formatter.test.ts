/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { formatProbeMetrics } from "./metrics-formatter"

describe("metrics formatter", () => {
  test("formatProbeMetrics #given metrics #when prometheus requested #then text exposes expected series", () => {
    const text = formatProbeMetrics({
      exchanges_total: [{ provider: "raw", status: "200", outcome: "success", count: 2 }],
      duration_quantiles: [{ provider: "raw", method: "GET", quantile: 0.5, value: 12 }],
      pool_healthy_ratio: [{ provider: "raw", value: 1 }],
      hypothesis_count: [{ status: "active", count: 1 }],
      circuit_breaker_open: [{ provider: "raw", value: 0 }],
      identity_burn_rate: [{ provider: "raw", value: 0 }],
    }, "prometheus")
    expect(text).toContain('probe_exchanges_total{provider="raw",status="200",outcome="success"} 2')
    expect(text).toContain('probe_exchange_duration_ms{provider="raw",method="GET",quantile="0.5"} 12')
  })
})
