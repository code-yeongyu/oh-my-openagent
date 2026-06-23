import { describe, expect, it } from "bun:test"
import { FORMALIZATION_ERROR_CODES, FormalizationError } from "./errors"

describe("FormalizationError", () => {
  describe("#given code provider_failure", () => {
    it("#when constructed #then has correct code", () => {
      const error = new FormalizationError({ code: "provider_failure" })

      expect(error.code).toBe("provider_failure")
    })
  })

  describe("#given code timeout", () => {
    it("#when constructed #then has correct code", () => {
      const error = new FormalizationError({ code: "timeout" })

      expect(error.code).toBe("timeout")
    })
  })

  describe("#given code schema_invalid", () => {
    it("#when constructed #then has correct code", () => {
      const error = new FormalizationError({ code: "schema_invalid" })

      expect(error.code).toBe("schema_invalid")
    })
  })

  describe("#given code theory_invalid", () => {
    it("#when constructed #then has correct code", () => {
      const error = new FormalizationError({ code: "theory_invalid" })

      expect(error.code).toBe("theory_invalid")
    })
  })

  describe("#given code confirmation_required", () => {
    it("#when constructed #then has correct code", () => {
      const error = new FormalizationError({ code: "confirmation_required" })

      expect(error.code).toBe("confirmation_required")
    })
  })
})

describe("FormalizationErrorCode", () => {
  it("#when enumerated #then has exactly 5 members", () => {
    expect(FORMALIZATION_ERROR_CODES).toHaveLength(5)
    expect(FORMALIZATION_ERROR_CODES).toEqual([
      "provider_failure",
      "timeout",
      "schema_invalid",
      "theory_invalid",
      "confirmation_required",
    ])
  })
})
