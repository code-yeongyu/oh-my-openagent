import { describe, expect, test } from "bun:test"
import { ZodError } from "zod/v4"
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
    test("#when parsed #then throws ZodError", () => {
      let thrownError: unknown

      try {
        BackgroundTaskConfigSchema.parse({
          circuitBreaker: {
            consecutiveThreshold: 4,
          },
        })
      } catch (error) {
        thrownError = error
      }

      expect(thrownError).toBeInstanceOf(ZodError)
    })
  })

  describe("#given consecutiveThreshold is zero", () => {
    test("#when parsed #then throws ZodError", () => {
      let thrownError: unknown

      try {
        BackgroundTaskConfigSchema.parse({
          circuitBreaker: {
            consecutiveThreshold: 0,
          },
        })
      } catch (error) {
        thrownError = error
      }

      expect(thrownError).toBeInstanceOf(ZodError)
    })
  })
})
