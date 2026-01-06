import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test"
import { createKeywordDetectorHook } from "./index"
import { setMainSession } from "../../features/claude-code-session-state"
import * as sharedModule from "../../shared"

describe("keyword-detector session filtering", () => {
  let logCalls: Array<{ msg: string; data?: unknown }>

  beforeEach(() => {
    setMainSession(undefined)
    logCalls = []
    spyOn(sharedModule, "log").mockImplementation((msg: string, data?: unknown) => {
      logCalls.push({ msg, data })
    })
  })

  afterEach(() => {
    setMainSession(undefined)
  })

  function createMockPluginInput(options: { toastCalls?: string[] } = {}) {
    const toastCalls = options.toastCalls ?? []
    return {
      client: {
        tui: {
          showToast: async (opts: any) => {
            toastCalls.push(opts.body.title)
          },
        },
      },
    } as any
  }

  test("should skip non-ultrawork keywords in non-main session (using mainSessionID check)", async () => {
    // #given - main session is set, different session submits search keyword
    const mainSessionID = "main-123"
    const subagentSessionID = "subagent-456"
    setMainSession(mainSessionID)

    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "search mode 찾아줘" }],
    }

    // #when - non-main session triggers keyword detection
    await hook["chat.message"](
      { sessionID: subagentSessionID },
      output
    )

    // #then - search keyword should be filtered out based on mainSessionID comparison
    const skipLog = logCalls.find(c => c.msg.includes("Skipping non-ultrawork keywords in non-main session"))
    expect(skipLog).toBeDefined()
  })

  test("should allow ultrawork keywords in non-main session", async () => {
    // #given - main session is set, different session submits ultrawork keyword
    const mainSessionID = "main-123"
    const subagentSessionID = "subagent-456"
    setMainSession(mainSessionID)

    const toastCalls: string[] = []
    const hook = createKeywordDetectorHook(createMockPluginInput({ toastCalls }))
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork mode" }],
    }

    // #when - non-main session triggers ultrawork keyword
    await hook["chat.message"](
      { sessionID: subagentSessionID },
      output
    )

    // #then - ultrawork should still work (variant set to max)
    expect(output.message.variant).toBe("max")
    expect(toastCalls).toContain("Ultrawork Mode Activated")
  })

  test("should allow all keywords in main session", async () => {
    // #given - main session submits search keyword
    const mainSessionID = "main-123"
    setMainSession(mainSessionID)

    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "search mode 찾아줘" }],
    }

    // #when - main session triggers keyword detection
    await hook["chat.message"](
      { sessionID: mainSessionID },
      output
    )

    // #then - search keyword should be detected (output unchanged but detection happens)
    // Note: search keywords don't set variant, they inject messages via context-injector
    // This test verifies the detection logic runs without filtering
    expect(output.message.variant).toBeUndefined() // search doesn't set variant
  })

  test("should allow all keywords when mainSessionID is not set", async () => {
    // #given - no main session set (early startup or standalone mode)
    setMainSession(undefined)

    const toastCalls: string[] = []
    const hook = createKeywordDetectorHook(createMockPluginInput({ toastCalls }))
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork search" }],
    }

    // #when - any session triggers keyword detection
    await hook["chat.message"](
      { sessionID: "any-session" },
      output
    )

    // #then - all keywords should work
    expect(output.message.variant).toBe("max")
    expect(toastCalls).toContain("Ultrawork Mode Activated")
  })
})
