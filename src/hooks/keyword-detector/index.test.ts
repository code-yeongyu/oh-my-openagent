import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test"
import { createKeywordDetectorHook } from "./index"
import { setMainSession, updateSessionAgent, clearSessionAgent, _resetForTesting } from "../../features/claude-code-session-state"
import { ContextCollector } from "../../features/context-injector"
import * as sharedModule from "../../shared"
import * as sessionState from "../../features/claude-code-session-state"

describe("keyword-detector message transform", () => {
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

  test("should prepend ultrawork message to text part", async () => {
    // #given - a fresh ContextCollector and keyword-detector hook
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "test-session-123"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork do something" }],
    }

    // #when - keyword detection runs
    await hook["chat.message"]({ sessionID }, output)

    // #then - message should be prepended to text part with separator and original text
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("---")
    expect(textPart!.text).toContain("do something")
    expect(textPart!.text).toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
  })

  test("should prepend search message to text part", async () => {
    // #given - mock getMainSessionID to return our session (isolate from global state)
    const collector = new ContextCollector()
    const sessionID = "search-test-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "search for the bug" }],
    }

    // #when - keyword detection runs
    await hook["chat.message"]({ sessionID }, output)

    // #then - search message should be prepended to text part
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("---")
    expect(textPart!.text).toContain("for the bug")
    expect(textPart!.text).toContain("[search-mode]")
  })

  test("should NOT transform when no keywords detected", async () => {
    // #given - no keywords in message
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "test-session"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "just a normal message" }],
    }

    // #when - keyword detection runs
    await hook["chat.message"]({ sessionID }, output)

    // #then - text should remain unchanged
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toBe("just a normal message")
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

  test("should not override existing variant", async () => {
    // #given - main session set with pre-existing variant
    setMainSession("main-123")

    const toastCalls: string[] = []
    const hook = createKeywordDetectorHook(createMockPluginInput({ toastCalls }))
    const output = {
      message: { variant: "low" } as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork mode" }],
    }

    // #when - ultrawork keyword triggers
    await hook["chat.message"](
      { sessionID: "main-123" },
      output
    )

    // #then - existing variant should remain
    expect(output.message.variant).toBe("low")
    expect(toastCalls).toContain("Ultrawork Mode Activated")
  })
})

describe("keyword-detector word boundary", () => {
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

  test("should NOT trigger ultrawork on partial matches like 'StatefulWidget' containing 'ulw'", async () => {
    // #given - text contains 'ulw' as part of another word (StatefulWidget)
    setMainSession(undefined)

    const toastCalls: string[] = []
    const hook = createKeywordDetectorHook(createMockPluginInput({ toastCalls }))
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "refactor the StatefulWidget component" }],
    }

    // #when - message with partial 'ulw' match is processed
    await hook["chat.message"](
      { sessionID: "any-session" },
      output
    )

    // #then - ultrawork should NOT be triggered
    expect(output.message.variant).toBeUndefined()
    expect(toastCalls).not.toContain("Ultrawork Mode Activated")
  })

  test("should trigger ultrawork on standalone 'ulw' keyword", async () => {
    // #given - text contains standalone 'ulw'
    setMainSession(undefined)

    const toastCalls: string[] = []
    const hook = createKeywordDetectorHook(createMockPluginInput({ toastCalls }))
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ulw do this task" }],
    }

    // #when - message with standalone 'ulw' is processed
    await hook["chat.message"](
      { sessionID: "any-session" },
      output
    )

    // #then - ultrawork should be triggered
    expect(output.message.variant).toBe("max")
    expect(toastCalls).toContain("Ultrawork Mode Activated")
  })

  test("should NOT trigger ultrawork on file references containing 'ulw' substring", async () => {
    // #given - file reference contains 'ulw' as substring
    setMainSession(undefined)

    const toastCalls: string[] = []
    const hook = createKeywordDetectorHook(createMockPluginInput({ toastCalls }))
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "@StatefulWidget.tsx please review this file" }],
    }

    // #when - message referencing file with 'ulw' substring is processed
    await hook["chat.message"](
      { sessionID: "any-session" },
      output
    )

    // #then - ultrawork should NOT be triggered
    expect(output.message.variant).toBeUndefined()
    expect(toastCalls).not.toContain("Ultrawork Mode Activated")
  })
})

describe("keyword-detector agent-specific ultrawork messages", () => {
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

  test("should use planner-specific ultrawork message when agent is prometheus", async () => {
    // #given - collector and prometheus agent
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "prometheus-session"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork plan this feature" }],
    }

    // #when - ultrawork keyword detected with prometheus agent
    await hook["chat.message"]({ sessionID, agent: "prometheus" }, output)

    // #then - should use planner-specific message with "YOU ARE A PLANNER" content
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("YOU ARE A PLANNER, NOT AN IMPLEMENTER")
    expect(textPart!.text).not.toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
    expect(textPart!.text).toContain("---")
    expect(textPart!.text).toContain("plan this feature")
  })

  test("should use planner-specific ultrawork message when agent name contains 'planner'", async () => {
    // #given - collector and agent with 'planner' in name
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "planner-session"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ulw create a work plan" }],
    }

    // #when - ultrawork keyword detected with planner agent
    await hook["chat.message"]({ sessionID, agent: "Prometheus (Planner)" }, output)

    // #then - should use planner-specific message
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("YOU ARE A PLANNER, NOT AN IMPLEMENTER")
    expect(textPart!.text).toContain("---")
    expect(textPart!.text).toContain("create a work plan")
  })

  test("should use normal ultrawork message when agent is Sisyphus", async () => {
    // #given - collector and Sisyphus agent
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "sisyphus-session"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork implement this feature" }],
    }

    // #when - ultrawork keyword detected with Sisyphus agent
    await hook["chat.message"]({ sessionID, agent: "Sisyphus" }, output)

    // #then - should use normal ultrawork message with agent utilization instructions
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
    expect(textPart!.text).not.toContain("YOU ARE A PLANNER, NOT AN IMPLEMENTER")
    expect(textPart!.text).toContain("---")
    expect(textPart!.text).toContain("implement this feature")
  })

  test("should use normal ultrawork message when agent is undefined", async () => {
    // #given - collector with no agent specified
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "no-agent-session"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork do something" }],
    }

    // #when - ultrawork keyword detected without agent
    await hook["chat.message"]({ sessionID }, output)

    // #then - should use normal ultrawork message (default behavior)
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
    expect(textPart!.text).not.toContain("YOU ARE A PLANNER, NOT AN IMPLEMENTER")
    expect(textPart!.text).toContain("---")
    expect(textPart!.text).toContain("do something")
  })

  test("should switch from planner to normal message when agent changes", async () => {
    // #given - two sessions, one with prometheus, one with sisyphus
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)

    // First session with prometheus
    const prometheusSessionID = "prometheus-first"
    const prometheusOutput = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork plan" }],
    }
    await hook["chat.message"]({ sessionID: prometheusSessionID, agent: "prometheus" }, prometheusOutput)

    // Second session with sisyphus
    const sisyphusSessionID = "sisyphus-second"
    const sisyphusOutput = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork implement" }],
    }
    await hook["chat.message"]({ sessionID: sisyphusSessionID, agent: "Sisyphus" }, sisyphusOutput)

    // #then - each session should have the correct message type
    const prometheusTextPart = prometheusOutput.parts.find(p => p.type === "text")
    expect(prometheusTextPart!.text).toContain("YOU ARE A PLANNER, NOT AN IMPLEMENTER")
    expect(prometheusTextPart!.text).toContain("---")
    expect(prometheusTextPart!.text).toContain("plan")

    const sisyphusTextPart = sisyphusOutput.parts.find(p => p.type === "text")
    expect(sisyphusTextPart!.text).toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
    expect(sisyphusTextPart!.text).toContain("---")
    expect(sisyphusTextPart!.text).toContain("implement")
  })

  test("should use session state agent over stale input.agent (bug fix)", async () => {
    // #given - same session, agent switched from prometheus to sisyphus in session state
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "same-session-agent-switch"

    // Simulate: session state was updated to sisyphus (by index.ts updateSessionAgent)
    updateSessionAgent(sessionID, "Sisyphus")

    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork implement this" }],
    }

    // #when - hook receives stale input.agent="prometheus" but session state says "Sisyphus"
    await hook["chat.message"]({ sessionID, agent: "prometheus" }, output)

    // #then - should use Sisyphus from session state, NOT prometheus from stale input
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
    expect(textPart!.text).not.toContain("YOU ARE A PLANNER, NOT AN IMPLEMENTER")
    expect(textPart!.text).toContain("---")
    expect(textPart!.text).toContain("implement this")

    // cleanup
    clearSessionAgent(sessionID)
  })

  test("should fall back to input.agent when session state is empty", async () => {
    // #given - no session state, only input.agent available
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "no-session-state"

    // Ensure no session state
    clearSessionAgent(sessionID)

    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork plan this" }],
    }

    // #when - hook receives input.agent="prometheus" with no session state
    await hook["chat.message"]({ sessionID, agent: "prometheus" }, output)

    // #then - should use prometheus from input.agent as fallback
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("YOU ARE A PLANNER, NOT AN IMPLEMENTER")
    expect(textPart!.text).toContain("---")
    expect(textPart!.text).toContain("plan this")
  })
})
