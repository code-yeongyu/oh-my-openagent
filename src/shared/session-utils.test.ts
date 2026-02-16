import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { resetAgentNameAliases } from "./agent-name-aliases"

describe("session-utils", () => {
  let sessionUtils: any
  let getMessageDirSpy: ReturnType<typeof spyOn>
  let findNearestSpy: ReturnType<typeof spyOn>
  let isSqliteBackendSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    resetAgentNameAliases()
    const storageDetection = require("./opencode-storage-detection")
    isSqliteBackendSpy = spyOn(storageDetection, "isSqliteBackend").mockReturnValue(false)
    const injector = require("../features/hook-message-injector")
    findNearestSpy = spyOn(injector, "findNearestMessageWithFields").mockReturnValue({ agent: "atlas" })
    sessionUtils = require("./session-utils")
    getMessageDirSpy = spyOn(sessionUtils, "getMessageDir" as any).mockReturnValue("/tmp/fake-dir")
  })

  afterEach(() => {
    getMessageDirSpy?.mockRestore()
    isSqliteBackendSpy?.mockRestore()
    findNearestSpy?.mockRestore()
  })

  test("returns false when sessionID is undefined", async () => {
    expect(await sessionUtils.isCallerOrchestrator(undefined)).toBe(false)
  })

  test("returns false when no message directory exists", async () => {
    getMessageDirSpy.mockReturnValue(null)
    expect(await sessionUtils.isCallerOrchestrator("ses_test")).toBe(false)
  })

  test("isCallerOrchestrator is async", async () => {
    const result = sessionUtils.isCallerOrchestrator("ses_test")
    expect(result instanceof Promise).toBe(true)
    await result
  })
})
