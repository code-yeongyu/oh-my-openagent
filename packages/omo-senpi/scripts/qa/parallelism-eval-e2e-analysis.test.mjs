import { describe, expect, test } from "bun:test"

import {
  EXPECTED_PARALLELISM_PROPERTY_KEYS,
  analyzeParallelismRequests,
  verdict,
} from "./parallelism-eval-e2e-analysis.mjs"

function properties(overrides = {}) {
  const value = Object.fromEntries(EXPECTED_PARALLELISM_PROPERTY_KEYS.map((key) => [key, 0]))
  return {
    ...value,
    $geoip_disable: true,
    $process_person_profile: false,
    $session_id: "hashed-session",
    eval_execution_event_bus_available: true,
    non_eval_wave_size_histogram: "0:0:0:0:0:0:0:0",
    package_version: "5.0.0-beta.7",
    platform: "omo-senpi",
    product_name: "omo-native",
    schema_kind: "parallelism_v2",
    schema_version: 1,
    eval_execution_event_count: 1,
    eval_execution_ok_count: 1,
    eval_nested_tool_call_count: 2,
    eval_nested_tool_call_ok_count: 2,
    eval_nested_tool_call_error_count: 0,
    eval_nested_tool_call_pending_count: 0,
    eval_outer_joined_calls: 1,
    eval_only_waves: 1,
    ...overrides,
  }
}

function request(summaryProperties = properties()) {
  return {
    remoteAddress: "127.0.0.1",
    body: {
      batch: [
        { event: "session_started", properties: { schema_version: 1 } },
        { event: "parallelism_summary", properties: summaryProperties },
      ],
    },
  }
}

describe("parallelism eval e2e analysis", () => {
  test("#given one exact v2 summary #when analyzed #then every manual-QA invariant passes", () => {
    const checks = analyzeParallelismRequests([request()])

    expect(verdict(checks)).toEqual({ result: "PASS", failed: [] })
  })

  test("#given two summaries #when analyzed #then exactly-once fails", () => {
    const duplicate = request()
    duplicate.body.batch.push({ event: "parallelism_summary", properties: properties() })

    expect(analyzeParallelismRequests([duplicate]).exactlyOneSummary).toBe(false)
  })

  test("#given an extra property #when analyzed #then fixed allowlist equality fails", () => {
    const checks = analyzeParallelismRequests([request(properties({ leaked_path: "/secret" }))])

    expect(checks.fixedAllowlistedKeysOnly).toBe(false)
  })

  test("#given inconsistent nested statuses #when analyzed #then exact nested accounting fails", () => {
    const checks = analyzeParallelismRequests([
      request(properties({ eval_nested_tool_call_ok_count: 1 })),
    ])

    expect(checks.nestedCountsExact).toBe(false)
  })

  test("#given non-loopback traffic #when analyzed #then localhost-only telemetry fails", () => {
    const outside = request()
    outside.remoteAddress = "10.0.0.2"

    expect(analyzeParallelismRequests([outside]).localhostOnlyTelemetry).toBe(false)
  })
})
