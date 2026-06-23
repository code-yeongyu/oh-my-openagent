import { describe, test, expect, beforeEach } from "bun:test"
import { auditRawInteraction, setAuditMode, getAuditMode } from "./audit"
import { RawInteractionForbiddenError } from "../types"

describe("audit guard", () => {
  beforeEach(() => {
    setAuditMode("enforce")
  })

  describe("#given enforce mode", () => {
    test("#when raw click called #then throws RawInteractionForbiddenError", () => {
      expect(() => auditRawInteraction("click")).toThrow(RawInteractionForbiddenError)
    })

    test("#when raw fill called #then throws", () => {
      expect(() => auditRawInteraction("fill")).toThrow(RawInteractionForbiddenError)
    })

    test("#when non-raw method called #then does not throw", () => {
      expect(() => auditRawInteraction("goto")).not.toThrow()
    })
  })

  describe("#given off mode", () => {
    test("#when raw click called #then does not throw", () => {
      setAuditMode("off")
      expect(() => auditRawInteraction("click")).not.toThrow()
    })
  })

  describe("#given warn mode", () => {
    test("#when raw click called #then does not throw", () => {
      setAuditMode("warn")
      expect(() => auditRawInteraction("click")).not.toThrow()
    })
  })

  test("#given setAuditMode #when mode set #then getAuditMode returns it", () => {
    setAuditMode("warn")
    expect(getAuditMode()).toBe("warn")
  })
})
