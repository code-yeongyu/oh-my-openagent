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
    _resetForTesting()
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
    // given - a fresh ContextCollector and keyword-detector hook
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "test-session-123"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork do something" }],
    }

    // when - keyword detection runs
    await hook["chat.message"]({ sessionID }, output)

    // then - message should be prepended to text part with separator and original text
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("---")
    expect(textPart!.text).toContain("do something")
    expect(textPart!.text).toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
  })

  test("should prepend search message to text part", async () => {
    // given - mock getMainSessionID to return our session (isolate from global state)
    const collector = new ContextCollector()
    const sessionID = "search-test-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "search for the bug" }],
    }

    // when - keyword detection runs
    await hook["chat.message"]({ sessionID }, output)

    // then - search message should be prepended to text part
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("---")
    expect(textPart!.text).toContain("for the bug")
    expect(textPart!.text).toContain("[search-mode]")
  })

  test("should NOT transform when no keywords detected", async () => {
    // given - no keywords in message
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "test-session"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "just a normal message" }],
    }

    // when - keyword detection runs
    await hook["chat.message"]({ sessionID }, output)

    // then - text should remain unchanged
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toBe("just a normal message")
  })
})

describe("keyword-detector session filtering", () => {
  let logCalls: Array<{ msg: string; data?: unknown }>
  let logSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    _resetForTesting()
    logCalls = []
    logSpy = spyOn(sharedModule, "log").mockImplementation((msg: string, data?: unknown) => {
      logCalls.push({ msg, data })
    })
  })

  afterEach(() => {
    logSpy?.mockRestore()
    _resetForTesting()
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
    // given - main session is set, different session submits search keyword
    const mainSessionID = "main-123"
    const subagentSessionID = "subagent-456"
    setMainSession(mainSessionID)

    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "search mode 찾아줘" }],
    }

    // when - non-main session triggers keyword detection
    await hook["chat.message"](
      { sessionID: subagentSessionID },
      output
    )

    // then - search keyword should be filtered out based on mainSessionID comparison
    const skipLog = logCalls.find(c => c.msg.includes("Skipping non-ultrawork keywords in non-main session"))
    expect(skipLog).toBeDefined()
  })

  test("should allow ultrawork keywords in non-main session", async () => {
    // given - main session is set, different session submits ultrawork keyword
    const mainSessionID = "main-123"
    const subagentSessionID = "subagent-456"
    setMainSession(mainSessionID)

    const toastCalls: string[] = []
    const hook = createKeywordDetectorHook(createMockPluginInput({ toastCalls }))
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork mode" }],
    }

    // when - non-main session triggers ultrawork keyword
    await hook["chat.message"](
      { sessionID: subagentSessionID },
      output
    )

    // then - ultrawork should still work without forcing a new variant
    expect(output.message.variant).toBeUndefined()
    expect(toastCalls).toContain("Ultrawork Mode Activated")
  })

  test("should allow all keywords in main session", async () => {
    // given - main session submits search keyword
    const mainSessionID = "main-123"
    setMainSession(mainSessionID)

    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "search mode 찾아줘" }],
    }

    // when - main session triggers keyword detection
    await hook["chat.message"](
      { sessionID: mainSessionID },
      output
    )

    // then - search keyword should be detected (output unchanged but detection happens)
    // Note: search keywords don't set variant, they inject messages via context-injector
    // This test verifies the detection logic runs without filtering
    expect(output.message.variant).toBeUndefined() // search doesn't set variant
  })

  test("should allow all keywords when mainSessionID is not set", async () => {
    // given - no main session set (early startup or standalone mode)
    setMainSession(undefined)

    const toastCalls: string[] = []
    const hook = createKeywordDetectorHook(createMockPluginInput({ toastCalls }))
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork search" }],
    }

    // when - any session triggers keyword detection
    await hook["chat.message"](
      { sessionID: "any-session" },
      output
    )

    // then - all keywords should work without forcing a new variant
    expect(output.message.variant).toBeUndefined()
    expect(toastCalls).toContain("Ultrawork Mode Activated")
  })

  test("should preserve existing runtime variant when ultrawork keyword is used", async () => {
    // given - main session set with pre-existing variant from TUI
    setMainSession("main-123")

    const toastCalls: string[] = []
    const hook = createKeywordDetectorHook(createMockPluginInput({ toastCalls }))
    const output = {
      message: { variant: "low" } as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork mode" }],
    }

    // when - ultrawork keyword triggers
    await hook["chat.message"](
      { sessionID: "main-123" },
      output
    )

    // then - ultrawork should preserve the already resolved runtime variant
    expect(output.message.variant).toBe("low")
    expect(toastCalls).toContain("Ultrawork Mode Activated")
  })
})

describe("keyword-detector word boundary", () => {
  let logCalls: Array<{ msg: string; data?: unknown }>
  let logSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    _resetForTesting()
    logCalls = []
    logSpy = spyOn(sharedModule, "log").mockImplementation((msg: string, data?: unknown) => {
      logCalls.push({ msg, data })
    })
  })

  afterEach(() => {
    logSpy?.mockRestore()
    _resetForTesting()
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
    // given - text contains 'ulw' as part of another word (StatefulWidget)
    setMainSession(undefined)

    const toastCalls: string[] = []
    const hook = createKeywordDetectorHook(createMockPluginInput({ toastCalls }))
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "refactor the StatefulWidget component" }],
    }

    // when - message with partial 'ulw' match is processed
    await hook["chat.message"](
      { sessionID: "any-session" },
      output
    )

    // then - ultrawork should NOT be triggered
    expect(output.message.variant).toBeUndefined()
    expect(toastCalls).not.toContain("Ultrawork Mode Activated")
  })

  test("should trigger ultrawork on standalone 'ulw' keyword", async () => {
    // given - text contains standalone 'ulw'
    setMainSession(undefined)

    const toastCalls: string[] = []
    const hook = createKeywordDetectorHook(createMockPluginInput({ toastCalls }))
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ulw do this task" }],
    }

    // when - message with standalone 'ulw' is processed
    await hook["chat.message"](
      { sessionID: "any-session" },
      output
    )

    // then - ultrawork should be triggered without forcing max
    expect(output.message.variant).toBeUndefined()
    expect(toastCalls).toContain("Ultrawork Mode Activated")
  })

  test("should NOT trigger ultrawork on file references containing 'ulw' substring", async () => {
    // given - file reference contains 'ulw' as substring
    setMainSession(undefined)

    const toastCalls: string[] = []
    const hook = createKeywordDetectorHook(createMockPluginInput({ toastCalls }))
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "@StatefulWidget.tsx please review this file" }],
    }

    // when - message referencing file with 'ulw' substring is processed
    await hook["chat.message"](
      { sessionID: "any-session" },
      output
    )

    // then - ultrawork should NOT be triggered
    expect(output.message.variant).toBeUndefined()
    expect(toastCalls).not.toContain("Ultrawork Mode Activated")
  })
})

describe("keyword-detector system-reminder filtering", () => {
  let logCalls: Array<{ msg: string; data?: unknown }>
  let logSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    _resetForTesting()
    logCalls = []
    logSpy = spyOn(sharedModule, "log").mockImplementation((msg: string, data?: unknown) => {
      logCalls.push({ msg, data })
    })
  })

  afterEach(() => {
    logSpy?.mockRestore()
    _resetForTesting()
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

  test("should NOT trigger search mode from keywords inside <system-reminder> tags", async () => {
    // given - message contains search keywords only inside system-reminder tags
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "test-session"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{
        type: "text",
        text: `<system-reminder>
The system will search for the file and find all occurrences.
Please locate and scan the directory.
</system-reminder>`
      }],
    }

    // when - keyword detection runs on system-reminder content
    await hook["chat.message"]({ sessionID }, output)

    // then - should NOT trigger search mode (text should remain unchanged)
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).not.toContain("[search-mode]")
    expect(textPart!.text).toContain("<system-reminder>")
  })

  test("should NOT trigger analyze mode from keywords inside <system-reminder> tags", async () => {
    // given - message contains analyze keywords only inside system-reminder tags
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "test-session"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{
        type: "text",
        text: `<system-reminder>
You should investigate and examine the code carefully.
Research the implementation details.
</system-reminder>`
      }],
    }

    // when - keyword detection runs on system-reminder content
    await hook["chat.message"]({ sessionID }, output)

    // then - should NOT trigger analyze mode
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).not.toContain("[analyze-mode]")
    expect(textPart!.text).toContain("<system-reminder>")
  })

  test("should detect keywords in user text even when system-reminder is present", async () => {
    // given - message contains both system-reminder and user search keyword
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "test-session"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{
        type: "text",
        text: `<system-reminder>
System will find and locate files.
</system-reminder>

Please search for the bug in the code.`
      }],
    }

    // when - keyword detection runs on mixed content
    await hook["chat.message"]({ sessionID }, output)

    // then - should trigger search mode from user text only
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("[search-mode]")
    expect(textPart!.text).toContain("Please search for the bug in the code.")
  })

  test("should handle multiple system-reminder tags in message", async () => {
    // given - message contains multiple system-reminder blocks with keywords
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "test-session"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{
        type: "text",
        text: `<system-reminder>
First reminder with search and find keywords.
</system-reminder>

User message without keywords.

<system-reminder>
Second reminder with investigate and examine keywords.
</system-reminder>`
      }],
    }

    // when - keyword detection runs on message with multiple system-reminders
    await hook["chat.message"]({ sessionID }, output)

    // then - should NOT trigger any mode (only user text exists, no keywords)
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).not.toContain("[search-mode]")
    expect(textPart!.text).not.toContain("[analyze-mode]")
  })

  test("should handle case-insensitive system-reminder tags", async () => {
    // given - message contains system-reminder with different casing
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "test-session"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{
        type: "text",
        text: `<SYSTEM-REMINDER>
System will search and find files.
</SYSTEM-REMINDER>`
      }],
    }

    // when - keyword detection runs on uppercase system-reminder
    await hook["chat.message"]({ sessionID }, output)

    // then - should NOT trigger search mode
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).not.toContain("[search-mode]")
  })

  test("should handle multiline system-reminder content with search keywords", async () => {
    // given - system-reminder with multiline content containing various search keywords
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "test-session"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{
        type: "text",
        text: `<system-reminder>
Commands executed:
- find: searched for pattern
- grep: located file
- scan: completed

Please explore the codebase and discover patterns.
</system-reminder>`
      }],
    }

    // when - keyword detection runs on multiline system-reminder
    await hook["chat.message"]({ sessionID }, output)

    // then - should NOT trigger search mode
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).not.toContain("[search-mode]")
  })
})

describe("keyword-detector agent-specific ultrawork messages", () => {
  let logCalls: Array<{ msg: string; data?: unknown }>
  let logSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    _resetForTesting()
    logCalls = []
    logSpy = spyOn(sharedModule, "log").mockImplementation((msg: string, data?: unknown) => {
      logCalls.push({ msg, data })
    })
  })

  afterEach(() => {
    logSpy?.mockRestore()
    _resetForTesting()
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

  test("should skip ultrawork injection when agent is prometheus", async () => {
    // given - collector and prometheus agent
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "prometheus-session"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork plan this feature" }],
    }

    // when - ultrawork keyword detected with prometheus agent
    await hook["chat.message"]({ sessionID, agent: "prometheus" }, output)

    // then - ultrawork should be skipped for planner agents, text unchanged
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toBe("ultrawork plan this feature")
    expect(textPart!.text).not.toContain("YOU ARE A PLANNER, NOT AN IMPLEMENTER")
    expect(textPart!.text).not.toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
  })

  test("should skip ultrawork injection when agent name contains 'planner'", async () => {
    // given - collector and agent with 'planner' in name
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "planner-session"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ulw create a work plan" }],
    }

    // when - ultrawork keyword detected with planner agent
    await hook["chat.message"]({ sessionID, agent: "Prometheus (Planner)" }, output)

    // then - ultrawork should be skipped, text unchanged
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toBe("ulw create a work plan")
    expect(textPart!.text).not.toContain("YOU ARE A PLANNER, NOT AN IMPLEMENTER")
  })

  test("should skip ultrawork injection when agent name contains 'plan' token", async () => {
    //#given - collector and agent name that includes a plan token
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "plan-agent-session"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork draft a plan" }],
    }

    //#when - ultrawork keyword detected with plan-like agent name
    await hook["chat.message"]({ sessionID, agent: "Plan Agent" }, output)

    //#then - ultrawork should be skipped, text unchanged
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toBe("ultrawork draft a plan")
    expect(textPart!.text).not.toContain("YOU ARE A PLANNER, NOT AN IMPLEMENTER")
  })

  test("should use normal ultrawork message when agent is Sisyphus", async () => {
    // given - collector and Sisyphus agent
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "sisyphus-session"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork implement this feature" }],
    }

    // when - ultrawork keyword detected with Sisyphus agent
    await hook["chat.message"]({ sessionID, agent: "sisyphus" }, output)

    // then - should use normal ultrawork message with agent utilization instructions
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
    expect(textPart!.text).not.toContain("YOU ARE A PLANNER, NOT AN IMPLEMENTER")
    expect(textPart!.text).toContain("---")
    expect(textPart!.text).toContain("implement this feature")
  })

  test("should use normal ultrawork message when agent is undefined", async () => {
    // given - collector with no agent specified
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "no-agent-session"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork do something" }],
    }

    // when - ultrawork keyword detected without agent
    await hook["chat.message"]({ sessionID }, output)

    // then - should use normal ultrawork message (default behavior)
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
    expect(textPart!.text).not.toContain("YOU ARE A PLANNER, NOT AN IMPLEMENTER")
    expect(textPart!.text).toContain("---")
    expect(textPart!.text).toContain("do something")
  })

  test("should skip ultrawork for prometheus but inject for sisyphus", async () => {
    // given - two sessions, one with prometheus, one with sisyphus
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
    await hook["chat.message"]({ sessionID: sisyphusSessionID, agent: "sisyphus" }, sisyphusOutput)

    // then - prometheus should have no injection, sisyphus should have normal ultrawork
    const prometheusTextPart = prometheusOutput.parts.find(p => p.type === "text")
    expect(prometheusTextPart!.text).toBe("ultrawork plan")

    const sisyphusTextPart = sisyphusOutput.parts.find(p => p.type === "text")
    expect(sisyphusTextPart!.text).toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
    expect(sisyphusTextPart!.text).toContain("---")
    expect(sisyphusTextPart!.text).toContain("implement")
  })

  test("should use session state agent over stale input.agent (bug fix)", async () => {
    // given - same session, agent switched from prometheus to sisyphus in session state
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "same-session-agent-switch"

    // Simulate: session state was updated to sisyphus (by index.ts updateSessionAgent)
    updateSessionAgent(sessionID, "sisyphus")

    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork implement this" }],
    }

    // when - hook receives stale input.agent="prometheus" but session state says "Sisyphus"
    await hook["chat.message"]({ sessionID, agent: "prometheus" }, output)

    // then - should use Sisyphus from session state, NOT prometheus from stale input
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
    expect(textPart!.text).not.toContain("YOU ARE A PLANNER, NOT AN IMPLEMENTER")
    expect(textPart!.text).toContain("---")
    expect(textPart!.text).toContain("implement this")

    // cleanup
    clearSessionAgent(sessionID)
  })

  test("should fall back to input.agent when session state is empty and skip ultrawork for prometheus", async () => {
    // given - no session state, only input.agent available
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "no-session-state"

    // Ensure no session state
    clearSessionAgent(sessionID)

    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork plan this" }],
    }

    // when - hook receives input.agent="prometheus" with no session state
    await hook["chat.message"]({ sessionID, agent: "prometheus" }, output)

    // then - prometheus fallback from input.agent, ultrawork skipped
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toBe("ultrawork plan this")
    expect(textPart!.text).not.toContain("YOU ARE A PLANNER, NOT AN IMPLEMENTER")
  })
})

describe("keyword-detector tmux-script mode", () => {
  let logSpy: ReturnType<typeof spyOn>
  let getMainSessionSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    _resetForTesting()
    logSpy = spyOn(sharedModule, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy?.mockRestore()
    getMainSessionSpy?.mockRestore()
    _resetForTesting()
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

  test("should inject tmux-script message when 'tmux script' is in prompt", async () => {
    // given - main session with tmux script keyword
    const sessionID = "tmux-test-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const toastCalls: string[] = []
    const hook = createKeywordDetectorHook(createMockPluginInput({ toastCalls }))
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "tmux script for this project" }],
    }

    // when - keyword detection runs
    await hook["chat.message"]({ sessionID }, output)

    // then - tmux-script message should be injected
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("[tmux-script-mode]")
    expect(textPart!.text).toContain("for this project")
    expect(textPart!.text).toContain("---")
    expect(toastCalls).toContain("Tmux Script Mode")
  })

  test("should inject tmux-script message when 'tmux setup' is in prompt", async () => {
    // given - main session with tmux setup keyword
    const sessionID = "tmux-setup-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "tmux setup my dev environment" }],
    }

    // when - keyword detection runs
    await hook["chat.message"]({ sessionID }, output)

    // then - tmux-script message should be injected
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("[tmux-script-mode]")
  })

  test("should inject tmux-script message when 'dev environment script' is in prompt", async () => {
    // given - main session with dev environment script keyword
    const sessionID = "dev-env-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "create a dev environment script for this repo" }],
    }

    // when - keyword detection runs
    await hook["chat.message"]({ sessionID }, output)

    // then - tmux-script message should be injected
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("[tmux-script-mode]")
  })

  test("should NOT inject tmux-script in non-main session", async () => {
    // given - non-main session with tmux keyword
    const mainSessionID = "main-session"
    const subSessionID = "sub-session"
    setMainSession(mainSessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "tmux script please" }],
    }

    // when - non-main session triggers keyword
    await hook["chat.message"]({ sessionID: subSessionID }, output)

    // then - tmux-script should be filtered (only ultrawork allowed in non-main)
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).not.toContain("[tmux-script-mode]")
  })

  test("should NOT trigger on partial matches like 'tmuxinator script'", async () => {
    // given - text with tmux as substring of another word
    const sessionID = "no-match-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "use tmuxinator for session management" }],
    }

    // when - keyword detection runs
    await hook["chat.message"]({ sessionID }, output)

    // then - should not trigger tmux-script mode
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).not.toContain("[tmux-script-mode]")
  })
})

describe("keyword-detector watch-github-issues mode", () => {
  let logSpy: ReturnType<typeof spyOn>
  let getMainSessionSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    _resetForTesting()
    logSpy = spyOn(sharedModule, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy?.mockRestore()
    getMainSessionSpy?.mockRestore()
    _resetForTesting()
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

  test("should inject watch-github-issues message when 'watch github issues' is in prompt", async () => {
    // given - main session with watch github issues keyword
    const sessionID = "watch-issues-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const toastCalls: string[] = []
    const hook = createKeywordDetectorHook(createMockPluginInput({ toastCalls }))
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "watch github issues for this repo" }],
    }

    // when - keyword detection runs
    await hook["chat.message"]({ sessionID }, output)

    // then - watch-github-issues message should be injected
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("[watch-github-issues-mode]")
    expect(textPart!.text).toContain("for this repo")
    expect(textPart!.text).toContain("---")
    expect(toastCalls).toContain("GitHub Issue Watcher")
  })

  test("should inject message when 'monitor issues' is in prompt", async () => {
    // given - main session with monitor issues keyword
    const sessionID = "monitor-issues-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "monitor issues and fix them" }],
    }

    // when - keyword detection runs
    await hook["chat.message"]({ sessionID }, output)

    // then - watch-github-issues message should be injected
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("[watch-github-issues-mode]")
  })

  test("should inject message when 'track issues' is in prompt", async () => {
    // given - main session with track issues keyword
    const sessionID = "track-issues-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "track issues on our github" }],
    }

    // when - keyword detection runs
    await hook["chat.message"]({ sessionID }, output)

    // then - watch-github-issues message should be injected
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("[watch-github-issues-mode]")
  })

  test("should inject message when 'watch gh issues' is in prompt", async () => {
    // given - main session with shorthand gh keyword
    const sessionID = "gh-issues-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "watch gh issues periodically" }],
    }

    // when - keyword detection runs
    await hook["chat.message"]({ sessionID }, output)

    // then - watch-github-issues message should be injected
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("[watch-github-issues-mode]")
  })

  test("should inject message when 'issue watcher' is in prompt", async () => {
    // given - main session with issue watcher keyword
    const sessionID = "watcher-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "start the github issue watcher" }],
    }

    // when - keyword detection runs
    await hook["chat.message"]({ sessionID }, output)

    // then - watch-github-issues message should be injected
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("[watch-github-issues-mode]")
  })

  test("should NOT inject watch-github-issues in non-main session", async () => {
    // given - non-main session with watch issues keyword
    const mainSessionID = "main-session"
    const subSessionID = "sub-session"
    setMainSession(mainSessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "watch github issues please" }],
    }

    // when - non-main session triggers keyword
    await hook["chat.message"]({ sessionID: subSessionID }, output)

    // then - watch-github-issues should be filtered
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).not.toContain("[watch-github-issues-mode]")
  })

  test("should NOT trigger on 'issue' alone without watch/monitor/track prefix", async () => {
    // given - text with just 'issue' without watch context
    const sessionID = "no-match-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "fix this issue in the code" }],
    }

    // when - keyword detection runs
    await hook["chat.message"]({ sessionID }, output)

    // then - should not trigger watch-github-issues mode
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).not.toContain("[watch-github-issues-mode]")
  })
})
