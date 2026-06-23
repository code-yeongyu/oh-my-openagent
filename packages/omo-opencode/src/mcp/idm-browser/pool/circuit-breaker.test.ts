import { describe, test, expect } from "bun:test"
import { createCircuitBreaker, type CircuitState } from "./circuit-breaker"
import { CircuitOpenError } from "../types"

describe("CircuitBreaker", () => {
  describe("#given new breaker", () => {
    test("#when created #then state is closed", () => {
      const cb = createCircuitBreaker("example.com")
      expect(cb.getState()).toBe("closed")
    })

    test("#when canAttempt #then returns true", () => {
      const cb = createCircuitBreaker("example.com")
      expect(cb.canAttempt()).toBe(true)
    })
  })

  describe("#given threshold exceeded", () => {
    test("#when 5 failures recorded #then state is open", () => {
      const cb = createCircuitBreaker("example.com", { failureThreshold: 5 })
      for (let i = 0; i < 5; i++) cb.recordFailure()
      expect(cb.getState()).toBe("open")
    })

    test("#when open and assertOpen called #then throws CircuitOpenError", () => {
      const cb = createCircuitBreaker("example.com", { failureThreshold: 2 })
      cb.recordFailure()
      cb.recordFailure()
      expect(() => cb.assertOpen()).toThrow(CircuitOpenError)
    })
  })

  describe("#given success after failures", () => {
    test("#when success recorded #then resets to closed", () => {
      const cb = createCircuitBreaker("example.com", { failureThreshold: 5 })
      for (let i = 0; i < 3; i++) cb.recordFailure()
      cb.recordSuccess()
      expect(cb.getState()).toBe("closed")
      expect(cb.getInfo().failureCount).toBe(0)
    })
  })
})
