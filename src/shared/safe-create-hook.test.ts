import { describe, test, expect, spyOn, afterEach } from "bun:test"
import * as shared from "./logger"
import { safeCreateHook } from "./safe-create-hook"

afterEach(() => {
  ;(shared.log as any)?.mockRestore?.()
})

describe("safeCreateHook", () => {
  test("returns hook object when factory succeeds", () => {
    //#given
    const hook = { handler: () => {} }
    const factory = () => hook

    //#when
    const result = safeCreateHook("test-hook", factory)

    //#then
    expect(result).toBe(hook)
  })

  test("returns null when factory throws", () => {
    //#given
    spyOn(shared, "log").mockImplementation(() => {})
    const factory = () => {
      throw new Error("boom")
    }

    //#when
    const result = safeCreateHook("test-hook", factory)

    //#then
    expect(result).toBeNull()
  })

  test("logs error when factory throws", () => {
    //#given
    const logSpy = spyOn(shared, "log").mockImplementation(() => {})
    const factory = () => {
      throw new Error("boom")
    }

    //#when
    safeCreateHook("my-hook", factory)

    //#then
    expect(logSpy).toHaveBeenCalled()
    const callArgs = logSpy.mock.calls[0]
    expect(callArgs[0]).toContain("my-hook")
    expect(callArgs[0]).toContain("Hook creation failed")
  })

  test("propagates error when enabled is false", () => {
    //#given
    const factory = () => {
      throw new Error("boom")
    }

    //#when + #then
    expect(() => safeCreateHook("test-hook", factory, { enabled: false })).toThrow("boom")
  })

  test("returns null for factory returning undefined", () => {
    //#given
    const factory = () => undefined as any

    //#when
    const result = safeCreateHook("test-hook", factory)

    //#then
    expect(result).toBeNull()
  })
})
