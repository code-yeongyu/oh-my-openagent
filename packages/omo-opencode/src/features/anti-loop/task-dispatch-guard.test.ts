import { describe, expect, it } from "bun:test"
import {
  validateTaskDispatch,
  buildTaskDispatchError,
  resolveAntiLoopSettings,
  type AntiLoopSettings,
} from "./task-dispatch-guard"
import type { BackgroundTaskConfig } from "../../config/schema/background-task"

const ENABLED: AntiLoopSettings = { enabled: true, consecutiveThreshold: 3 }

describe("validateTaskDispatch", () => {
  it("#given a valid category task #when validated #then ok", () => {
    const result = validateTaskDispatch("ses_a", { prompt: "do the thing", category: "quick" }, ENABLED)
    expect(result.ok).toBe(true)
    expect(result.tripped).toBe(false)
  })

  it("#given a valid continuation task_id #when validated #then ok", () => {
    const result = validateTaskDispatch("ses_b", { prompt: "continue", task_id: "ses_abc" }, ENABLED)
    expect(result.ok).toBe(true)
    expect(result.tripped).toBe(false)
  })

  it("#given category with empty prompt #when validated #then ok (prompt is optional)", () => {
    const result = validateTaskDispatch("ses_c", { category: "quick", prompt: "" }, ENABLED)
    expect(result.ok).toBe(true)
    expect(result.tripped).toBe(false)
  })

  it("#given missing all routing fields #when validated #then rejected", () => {
    const result = validateTaskDispatch("ses_d", { prompt: "x" }, ENABLED)
    expect(result.ok).toBe(false)
    expect(result.cause).toContain("category")
  })

  it("#given breaker disabled #when malformed repeated #then rejects but never trips", () => {
    const settings: AntiLoopSettings = { enabled: false, consecutiveThreshold: 3 }
    let last = validateTaskDispatch("ses_e", { prompt: "" }, settings)
    last = validateTaskDispatch("ses_e", { prompt: "" }, settings)
    last = validateTaskDispatch("ses_e", { prompt: "" }, settings)
    expect(last.ok).toBe(false)
    expect(last.tripped).toBe(false)
  })

  it("#given same malformed signature repeated #when threshold reached #then trips", () => {
    let last = validateTaskDispatch("ses_f", { prompt: "" }, ENABLED)
    expect(last.tripped).toBe(false)
    last = validateTaskDispatch("ses_f", { prompt: "" }, ENABLED)
    expect(last.tripped).toBe(false)
    last = validateTaskDispatch("ses_f", { prompt: "" }, ENABLED)
    expect(last.tripped).toBe(true)
  })

  it("#given valid dispatch between failures #when validated #then counter resets", () => {
    validateTaskDispatch("ses_g", { prompt: "" }, ENABLED)
    validateTaskDispatch("ses_g", { prompt: "" }, ENABLED)
    validateTaskDispatch("ses_g", { prompt: "ok", category: "quick" }, ENABLED)
    const after = validateTaskDispatch("ses_g", { prompt: "" }, ENABLED)
    expect(after.tripped).toBe(false)
  })
})

describe("buildTaskDispatchError", () => {
  it("#given tripped #when built #then includes fallback directive", () => {
    const msg = buildTaskDispatchError("prompt: x", true)
    expect(msg).toContain("TRIPPED")
    expect(msg).toContain("execute the work directly")
  })

  it("#given not tripped #when built #then concise", () => {
    const msg = buildTaskDispatchError("prompt: x", false)
    expect(msg).toContain("pre-dispatch validation")
    expect(msg).not.toContain("TRIPPED")
  })
})

describe("resolveAntiLoopSettings", () => {
  it("#given config with circuitBreaker #when resolved #then uses config values", () => {
    const config: BackgroundTaskConfig = {
      circuitBreaker: { enabled: false, consecutiveThreshold: 7 },
    }
    const resolved = resolveAntiLoopSettings(config)
    expect(resolved.enabled).toBe(false)
    expect(resolved.consecutiveThreshold).toBe(7)
  })

  it("#given no config #when resolved #then uses defaults", () => {
    const resolved = resolveAntiLoopSettings(undefined)
    expect(resolved.enabled).toBe(true)
    expect(resolved.consecutiveThreshold).toBeGreaterThan(0)
  })
})
