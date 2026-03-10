import { describe, expect, test } from "bun:test"
import { ZodError } from "zod/v4"
import { ModelSchedulerConfigSchema } from "./model-scheduler"

describe("ModelSchedulerConfigSchema", () => {
  test("parses valid scheduler config", () => {
    const result = ModelSchedulerConfigSchema.parse({
      enabled: true,
      interval_minutes: 60,
      mode: "active",
      preflight_on_session_created: true,
      failure_threshold: 2,
      recovery_threshold: 2,
      agent_cooldown_minutes: 180,
      protect_manual_routing: true,
      probe_enabled: true,
      probe_timeout_ms: 15000,
      probe_max_latency_ms: 8000,
    })

    expect(result.mode).toBe("active")
    expect(result.interval_minutes).toBe(60)
    expect(result.probe_enabled).toBe(true)
  })

  test("rejects invalid interval", () => {
    let thrownError: unknown

    try {
      ModelSchedulerConfigSchema.parse({ interval_minutes: 0 })
    } catch (error) {
      thrownError = error
    }

    expect(thrownError).toBeInstanceOf(ZodError)
  })

  test("rejects invalid probe timeout", () => {
    let thrownError: unknown

    try {
      ModelSchedulerConfigSchema.parse({ probe_timeout_ms: 999 })
    } catch (error) {
      thrownError = error
    }

    expect(thrownError).toBeInstanceOf(ZodError)
  })
})
