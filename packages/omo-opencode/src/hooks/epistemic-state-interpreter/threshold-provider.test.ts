import { describe, expect, it, spyOn } from "bun:test"
import * as loggerModule from "../../shared/logger"
import { DEFAULT_THRESHOLDS, resolveThresholds } from "./threshold-provider"

describe("resolveThresholds", () => {
  describe("#given no config #when resolved #then returns defaults", () => {
    it("returns default thresholds", () => {
      const thresholds = resolveThresholds()
      expect(thresholds).toEqual(DEFAULT_THRESHOLDS)
    })
  })

  describe("#given config with custom values #when resolved #then returns custom", () => {
    it("returns configured thresholds", () => {
      const thresholds = resolveThresholds({ epistemic_thresholds: { n: 5, m: 10, k: 20, t: 100 } })
      expect(thresholds).toEqual({ N: 5, M: 10, K: 20, T: 100 })
    })
  })

  describe("#given undefined epistemic_thresholds #when resolved #then returns defaults", () => {
    it("handles undefined thresholds", () => {
      const thresholds = resolveThresholds({ epistemic_thresholds: undefined })
      expect(thresholds.N).toBe(DEFAULT_THRESHOLDS.N)
    })
  })

  describe("#given invalid config (m < n) #when resolved #then returns defaults", () => {
    it("falls back to defaults when m is less than n", () => {
      const thresholds = resolveThresholds({ epistemic_thresholds: { n: 10, m: 5, k: 10, t: 50 } })
      expect(thresholds).toEqual(DEFAULT_THRESHOLDS)
    })

    it("logs quietly without writing to stderr", () => {
      const stderrSpy = spyOn(process.stderr, "write").mockReturnValue(true)
      const logSpy = spyOn(loggerModule, "log").mockImplementation(() => {})

      resolveThresholds({ epistemic_thresholds: { n: 10, m: 5, k: 10, t: 50 } })

      expect(stderrSpy).not.toHaveBeenCalled()
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("[epistemic] invalid threshold config"),
        expect.objectContaining({ n: 10, m: 5, k: 10, t: 50 }),
      )

      stderrSpy.mockRestore()
      logSpy.mockRestore()
    })
  })

  describe("#given config with k < m #when resolved #then returns defaults", () => {
    it("falls back to defaults when k is less than m", () => {
      const thresholds = resolveThresholds({ epistemic_thresholds: { n: 3, m: 5, k: 4, t: 50 } })
      expect(thresholds).toEqual(DEFAULT_THRESHOLDS)
    })
  })

  describe("#given config with minimum valid values #when resolved #then preserves them", () => {
    it("accepts minimal valid thresholds", () => {
      const thresholds = resolveThresholds({ epistemic_thresholds: { n: 1, m: 1, k: 1, t: 1 } })
      expect(thresholds).toEqual({ N: 1, M: 1, K: 1, T: 1 })
    })
  })
})
