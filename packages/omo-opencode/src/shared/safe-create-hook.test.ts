import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test"
import * as shared from "./logger"

let safeCreateHook: (typeof import("./safe-create-hook"))["safeCreateHook"]
let logSpy: ReturnType<typeof spyOn> | undefined

async function importFreshSafeCreateHookModule(): Promise<typeof import("./safe-create-hook")> {
  return import(`./safe-create-hook?test=${Date.now()}-${Math.random()}`)
}

async function loadFreshSafeCreateHookModule(): Promise<void> {
  ;({ safeCreateHook } = await importFreshSafeCreateHookModule())
}

beforeEach(() => {
  logSpy = undefined
})

afterEach(() => {
  logSpy?.mockRestore()
})

describe("safeCreateHook", () => {
  test("returns hook object when factory succeeds", async () => {
    //#given
    await loadFreshSafeCreateHookModule()
    const hook = { handler: () => {} }
    const factory = () => hook

    //#when
    const result = safeCreateHook("test-hook", factory)

    //#then
    expect(result).toBe(hook)
  })

  test("returns null when factory throws", async () => {
    //#given
    logSpy = spyOn(shared, "log")
    logSpy.mockImplementation(() => {})
    await loadFreshSafeCreateHookModule()
    const factory = () => {
      throw new Error("boom")
    }

    //#when
    const result = safeCreateHook("test-hook", factory)

    //#then
    expect(result).toBeNull()
  })

  test("logs error when factory throws", async () => {
    //#given
    logSpy = spyOn(shared, "log")
    logSpy.mockImplementation(() => {})
    await loadFreshSafeCreateHookModule()
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

  test("propagates error when enabled is false", async () => {
    //#given
    await loadFreshSafeCreateHookModule()
    const factory = () => {
      throw new Error("boom")
    }

    //#when + #then
    expect(() => safeCreateHook("test-hook", factory, { enabled: false })).toThrow("boom")
  })

  test("returns null for factory returning undefined", async () => {
    //#given
    await loadFreshSafeCreateHookModule()
    const factory = (): undefined => undefined

    //#when
    const result = safeCreateHook("test-hook", factory)

    //#then
    expect(result).toBeNull()
  })
})
