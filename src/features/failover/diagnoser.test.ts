import { describe, expect, test } from "bun:test"
import { ErrorDiagnoser } from "./diagnoser"

describe("ErrorDiagnoser header parsing", () => {
  test("Retry-After seconds", () => {
    const res = ErrorDiagnoser.diagnose("any", { "retry-after": "120" })
    expect(res.action).toBe("COOLING")
    expect(res.cooldownMs).toBe(120_000)
  })

  test("Retry-After HTTP-date", () => {
    const target = new Date(Date.now() + 60_000).toUTCString()
    const res = ErrorDiagnoser.diagnose("any", { "retry-after": target })
    expect(res.action).toBe("COOLING")
    expect(res.cooldownMs ?? 0).toBeGreaterThan(40_000)
    expect(res.cooldownMs ?? 0).toBeLessThan(80_000)
  })

  test("x-ratelimit-reset epoch seconds", () => {
    const epochSeconds = Math.floor((Date.now() + 90_000) / 1000)
    const res = ErrorDiagnoser.diagnose("any", { "x-ratelimit-reset": String(epochSeconds) })
    expect(res.action).toBe("COOLING")
    expect(res.cooldownMs ?? 0).toBeGreaterThan(70_000)
    expect(res.cooldownMs ?? 0).toBeLessThan(120_000)
  })

  test("x-ratelimit-reset delta seconds", () => {
    const res = ErrorDiagnoser.diagnose("any", { "x-ratelimit-reset": "45" })
    expect(res.action).toBe("COOLING")
    expect(res.cooldownMs ?? 0).toBeGreaterThan(40_000)
    expect(res.cooldownMs ?? 0).toBeLessThan(60_000)
  })

  test("x-ratelimit-reset epoch milliseconds", () => {
    const epochMs = Date.now() + 80_000
    const res = ErrorDiagnoser.diagnose("any", { "x-ratelimit-reset": String(epochMs) })
    expect(res.action).toBe("COOLING")
    expect(res.cooldownMs ?? 0).toBeGreaterThan(60_000)
    expect(res.cooldownMs ?? 0).toBeLessThan(110_000)
  })
})

