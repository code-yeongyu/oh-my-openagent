import { describe, expect, test } from "bun:test"
import { ZodError } from "zod"
import { ContinuationConfigSchema } from "./continuation"

describe("ContinuationConfigSchema", () => {
  describe("cooldownMs", () => {
    describe("#given valid cooldownMs (5000)", () => {
      test("#when parsed #then returns correct value", () => {
        const result = ContinuationConfigSchema.parse({ cooldownMs: 5000 })
        expect(result.cooldownMs).toBe(5000)
      })
    })

    describe("#given cooldownMs below minimum (999)", () => {
      test("#when parsed #then throws ZodError", () => {
        let thrownError: unknown
        try {
          ContinuationConfigSchema.parse({ cooldownMs: 999 })
        } catch (error) {
          thrownError = error
        }
        expect(thrownError).toBeInstanceOf(ZodError)
      })
    })

    describe("#given cooldownMs not provided", () => {
      test("#when parsed #then field is undefined", () => {
        const result = ContinuationConfigSchema.parse({})
        expect(result.cooldownMs).toBeUndefined()
      })
    })
  })

  describe("abortWindowMs", () => {
    describe("#given valid abortWindowMs (3000)", () => {
      test("#when parsed #then returns correct value", () => {
        const result = ContinuationConfigSchema.parse({ abortWindowMs: 3000 })
        expect(result.abortWindowMs).toBe(3000)
      })
    })

    describe("#given abortWindowMs below minimum (499)", () => {
      test("#when parsed #then throws ZodError", () => {
        let thrownError: unknown
        try {
          ContinuationConfigSchema.parse({ abortWindowMs: 499 })
        } catch (error) {
          thrownError = error
        }
        expect(thrownError).toBeInstanceOf(ZodError)
      })
    })

    describe("#given abortWindowMs not provided", () => {
      test("#when parsed #then field is undefined", () => {
        const result = ContinuationConfigSchema.parse({})
        expect(result.abortWindowMs).toBeUndefined()
      })
    })
  })

  describe("maxStagnationCount", () => {
    describe("#given valid maxStagnationCount (3)", () => {
      test("#when parsed #then returns correct value", () => {
        const result = ContinuationConfigSchema.parse({ maxStagnationCount: 3 })
        expect(result.maxStagnationCount).toBe(3)
      })
    })

    describe("#given maxStagnationCount below minimum (0)", () => {
      test("#when parsed #then throws ZodError", () => {
        let thrownError: unknown
        try {
          ContinuationConfigSchema.parse({ maxStagnationCount: 0 })
        } catch (error) {
          thrownError = error
        }
        expect(thrownError).toBeInstanceOf(ZodError)
      })
    })

    describe("#given maxStagnationCount not provided", () => {
      test("#when parsed #then field is undefined", () => {
        const result = ContinuationConfigSchema.parse({})
        expect(result.maxStagnationCount).toBeUndefined()
      })
    })
  })

  describe("maxConsecutiveFailures", () => {
    describe("#given valid maxConsecutiveFailures (5)", () => {
      test("#when parsed #then returns correct value", () => {
        const result = ContinuationConfigSchema.parse({ maxConsecutiveFailures: 5 })
        expect(result.maxConsecutiveFailures).toBe(5)
      })
    })

    describe("#given maxConsecutiveFailures below minimum (0)", () => {
      test("#when parsed #then throws ZodError", () => {
        let thrownError: unknown
        try {
          ContinuationConfigSchema.parse({ maxConsecutiveFailures: 0 })
        } catch (error) {
          thrownError = error
        }
        expect(thrownError).toBeInstanceOf(ZodError)
      })
    })

    describe("#given maxConsecutiveFailures not provided", () => {
      test("#when parsed #then field is undefined", () => {
        const result = ContinuationConfigSchema.parse({})
        expect(result.maxConsecutiveFailures).toBeUndefined()
      })
    })
  })

  describe("failureResetWindowMs", () => {
    describe("#given valid failureResetWindowMs (300000)", () => {
      test("#when parsed #then returns correct value", () => {
        const result = ContinuationConfigSchema.parse({ failureResetWindowMs: 300000 })
        expect(result.failureResetWindowMs).toBe(300000)
      })
    })

    describe("#given failureResetWindowMs below minimum (29999)", () => {
      test("#when parsed #then throws ZodError", () => {
        let thrownError: unknown
        try {
          ContinuationConfigSchema.parse({ failureResetWindowMs: 29999 })
        } catch (error) {
          thrownError = error
        }
        expect(thrownError).toBeInstanceOf(ZodError)
      })
    })

    describe("#given failureResetWindowMs not provided", () => {
      test("#when parsed #then field is undefined", () => {
        const result = ContinuationConfigSchema.parse({})
        expect(result.failureResetWindowMs).toBeUndefined()
      })
    })
  })

  describe("countdownSeconds", () => {
    describe("#given valid countdownSeconds (2)", () => {
      test("#when parsed #then returns correct value", () => {
        const result = ContinuationConfigSchema.parse({ countdownSeconds: 2 })
        expect(result.countdownSeconds).toBe(2)
      })
    })

    describe("#given countdownSeconds below minimum (0)", () => {
      test("#when parsed #then throws ZodError", () => {
        let thrownError: unknown
        try {
          ContinuationConfigSchema.parse({ countdownSeconds: 0 })
        } catch (error) {
          thrownError = error
        }
        expect(thrownError).toBeInstanceOf(ZodError)
      })
    })

    describe("#given countdownSeconds not provided", () => {
      test("#when parsed #then field is undefined", () => {
        const result = ContinuationConfigSchema.parse({})
        expect(result.countdownSeconds).toBeUndefined()
      })
    })
  })
})
