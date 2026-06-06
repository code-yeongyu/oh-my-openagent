import { describe, it, expect } from "bun:test"
import { EXIT_CODES } from "./exit-codes"

describe("EXIT_CODES", () => {
  describe("#given EXIT_CODES object", () => {
    describe("#when accessing SUCCESS property", () => {
      it("should return 0", () => {
        expect(EXIT_CODES.SUCCESS).toBe(0)
      })
    })

    describe("#when accessing FAILURE property", () => {
      it("should return 1", () => {
        expect(EXIT_CODES.FAILURE).toBe(1)
      })
    })

    describe("#when accessing EXECUTION_ERROR property", () => {
      it("should return 2", () => {
        expect(EXIT_CODES.EXECUTION_ERROR).toBe(2)
      })
    })

    describe("#when checking value types", () => {
      it("should have SUCCESS as number", () => {
        expect(typeof EXIT_CODES.SUCCESS).toBe("number")
      })

      it("should have FAILURE as number", () => {
        expect(typeof EXIT_CODES.FAILURE).toBe("number")
      })

      it("should have EXECUTION_ERROR as number", () => {
        expect(typeof EXIT_CODES.EXECUTION_ERROR).toBe("number")
      })
    })

    describe("#when attempting to modify properties", () => {
      it("should be frozen and prevent reassignment", () => {
        expect(() => {
          ;(EXIT_CODES as Record<string, number>).SUCCESS = 99
        }).toThrow()
      })

      it("should be frozen and prevent adding new properties", () => {
        expect(() => {
          ;(EXIT_CODES as Record<string, number>).NEW_CODE = 3
        }).toThrow()
      })
    })
  })
})
