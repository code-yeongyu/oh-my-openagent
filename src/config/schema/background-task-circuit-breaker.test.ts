import { describe, expect, test } from "bun:test"
import { ZodError } from "zod/v4"
import { BackgroundTaskConfigSchema } from "./background-task"

describe("BackgroundTaskConfigSchema.circuitBreaker", () => {
  describe("#given valid circuit breaker settings", () => {
    test("#when parsed #then returns nested config", () => {
      const result = BackgroundTaskConfigSchema.parse({
        circuitBreaker: {
          maxToolCalls: 150,
          windowSize: 10,
          repetitionThresholdPercent: 70,
        },
      })

      expect(result.circuitBreaker).toEqual({
        maxToolCalls: 150,
        windowSize: 10,
        repetitionThresholdPercent: 70,
      })
    })
  })

  describe("#given windowSize below minimum", () => {
    test("#when parsed #then throws ZodError", () => {
      let thrownError: unknown

      try {
        BackgroundTaskConfigSchema.parse({
          circuitBreaker: {
            windowSize: 4,
          },
        })
      } catch (error) {
        thrownError = error
      }

      expect(thrownError).toBeInstanceOf(ZodError)
    })
  })

  describe("#given repetitionThresholdPercent is zero", () => {
    test("#when parsed #then throws ZodError", () => {
      let thrownError: unknown

      try {
        BackgroundTaskConfigSchema.parse({
          circuitBreaker: {
            repetitionThresholdPercent: 0,
          },
        })
      } catch (error) {
        thrownError = error
      }

      expect(thrownError).toBeInstanceOf(ZodError)
    })
  })
})
