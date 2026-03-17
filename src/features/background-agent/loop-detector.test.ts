import { describe, expect, test } from "bun:test"
import {
  detectRepetitiveToolUse,
  recordToolCall,
  resolveCircuitBreakerSettings,
} from "./loop-detector"

function buildWindow(
  toolNames: string[],
  override?: Parameters<typeof resolveCircuitBreakerSettings>[0]
) {
  const settings = resolveCircuitBreakerSettings(override)

  return toolNames.reduce(
    (window, toolName) => recordToolCall(window, toolName, settings),
    undefined as ReturnType<typeof recordToolCall> | undefined
  )
}

describe("loop-detector", () => {
  describe("resolveCircuitBreakerSettings", () => {
    describe("#given nested circuit breaker config", () => {
      test("#when resolved #then nested values override defaults", () => {
        const result = resolveCircuitBreakerSettings({
          maxToolCalls: 200,
          circuitBreaker: {
            maxToolCalls: 120,
            windowSize: 10,
            repetitionThresholdPercent: 70,
          },
        })

        expect(result).toEqual({
          maxToolCalls: 120,
          windowSize: 10,
          repetitionThresholdPercent: 70,
        })
      })
    })
  })

  describe("detectRepetitiveToolUse", () => {
    describe("#given recent tools are diverse", () => {
      test("#when evaluated #then it does not trigger", () => {
        const window = buildWindow([
          "read",
          "grep",
          "edit",
          "bash",
          "read",
          "glob",
          "lsp_diagnostics",
          "read",
          "grep",
          "edit",
        ])

        const result = detectRepetitiveToolUse(window)

        expect(result.triggered).toBe(false)
      })
    })

    describe("#given the same tool dominates the recent window", () => {
      test("#when evaluated #then it triggers", () => {
        const window = buildWindow([
          "read",
          "read",
          "read",
          "edit",
          "read",
          "read",
          "read",
          "read",
          "grep",
          "read",
        ], {
          circuitBreaker: {
            windowSize: 10,
            repetitionThresholdPercent: 80,
          },
        })

        const result = detectRepetitiveToolUse(window)

        expect(result).toEqual({
          triggered: true,
          toolName: "read",
          repeatedCount: 8,
          sampleSize: 10,
          thresholdPercent: 80,
        })
      })
    })

    describe("#given the window is not full yet", () => {
      test("#when the current sample crosses the threshold #then it still triggers", () => {
        const window = buildWindow(["read", "read", "edit", "read", "read", "read", "read", "read"], {
          circuitBreaker: {
            windowSize: 10,
            repetitionThresholdPercent: 80,
          },
        })

        const result = detectRepetitiveToolUse(window)

        expect(result).toEqual({
          triggered: true,
          toolName: "read",
          repeatedCount: 7,
          sampleSize: 8,
          thresholdPercent: 80,
        })
      })
    })
  })
})
