import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test"
import { createKeywordDetectorHook } from "./index"
import { setMainSession, _resetForTesting } from "../../features/claude-code-session-state"
import { ContextCollector } from "../../features/context-injector"
import * as sharedModule from "../../shared"
import * as sessionState from "../../features/claude-code-session-state"

describe("keyword-detector registers to ContextCollector", () => {
  let logCalls: Array<{ msg: string; data?: unknown }>
  let logSpy: ReturnType<typeof spyOn>
  let getMainSessionSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    _resetForTesting()
    logCalls = []
    logSpy = spyOn(sharedModule, "log").mockImplementation((msg: string, data?: unknown) => {
      logCalls.push({ msg, data })
    })
  })

  afterEach(() => {
    logSpy?.mockRestore()
    getMainSessionSpy?.mockRestore()
  })

  function createMockPluginInput() {
    return {
      client: {
        tui: {
          showToast: async () => {},
        },
      },
    } as any
  }

  test("should register search keyword to ContextCollector", async () => {
    const collector = new ContextCollector()
    const sessionID = "search-test-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "search for the bug" }],
    }

    await hook["chat.message"]({ sessionID }, output)

    expect(collector.hasPending(sessionID)).toBe(true)
    const pending = collector.getPending(sessionID)
    expect(pending.entries.some((e) => e.id === "keyword-search")).toBe(true)
  })

  test("should register analyze keyword to ContextCollector", async () => {
    const collector = new ContextCollector()
    const sessionID = "analyze-test-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "analyze why this fails" }],
    }

    await hook["chat.message"]({ sessionID }, output)

    expect(collector.hasPending(sessionID)).toBe(true)
    const pending = collector.getPending(sessionID)
    expect(pending.entries.some((e) => e.id === "keyword-analyze")).toBe(true)
  })

  test("should NOT trigger ultrawork keywords (disabled; use /omo toggle)", async () => {
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "ulw-disabled"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork do something" }],
    }

    await hook["chat.message"]({ sessionID }, output)

    expect(collector.hasPending(sessionID)).toBe(false)
  })

  test("should NOT register to collector when no keywords detected", async () => {
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "test-session"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "just a normal message" }],
    }

    await hook["chat.message"]({ sessionID }, output)

    expect(collector.hasPending(sessionID)).toBe(false)
  })
})

describe("keyword-detector session filtering", () => {
  let logCalls: Array<{ msg: string; data?: unknown }>
  let logSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    setMainSession(undefined)
    logCalls = []
    logSpy = spyOn(sharedModule, "log").mockImplementation((msg: string, data?: unknown) => {
      logCalls.push({ msg, data })
    })
  })

  afterEach(() => {
    logSpy?.mockRestore()
    setMainSession(undefined)
  })

  function createMockPluginInput() {
    return {
      client: {
        tui: {
          showToast: async () => {},
        },
      },
    } as any
  }

  test("should skip non-ultrawork keywords in non-main session (using mainSessionID check)", async () => {
    const mainSessionID = "main-123"
    const nonMainSessionID = "other-456"
    setMainSession(mainSessionID)

    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "search mode 찾아줘" }],
    }

    await hook["chat.message"]({ sessionID: nonMainSessionID }, output)

    const skipLog = logCalls.find((c) => c.msg.includes("Skipping non-ultrawork keywords in non-main session"))
    expect(skipLog).toBeDefined()
  })
})

