import { describe, expect, test } from "bun:test"
import { BackgroundTaskConfigSchema } from "./background-task"

describe("BackgroundTaskConfigSchema.circuitBreaker", () => {
  describe("#given valid circuit breaker settings", () => {
    test("#when parsed #then returns nested config", () => {
      const result = BackgroundTaskConfigSchema.parse({
        circuitBreaker: {
          maxToolCalls: 150,
          consecutiveThreshold: 10,
        },
      })
      expect(result.circuitBreaker).toEqual({
        maxToolCalls: 150,
        consecutiveThreshold: 10,
      })
    })
  })

  describe("#given consecutiveThreshold below minimum", () => {
    test("#when parsed #then reports schema failure", () => {
      const result = BackgroundTaskConfigSchema.safeParse({
        circuitBreaker: {
          consecutiveThreshold: 4,
        },
      })

      expect(result.success).toBe(false)
    })
  })

  describe("#given consecutiveThreshold is zero", () => {
    test("#when parsed #then reports schema failure", () => {
      const result = BackgroundTaskConfigSchema.safeParse({
        circuitBreaker: {
          consecutiveThreshold: 0,
        },
      })

      expect(result.success).toBe(false)
    })
  })
})
