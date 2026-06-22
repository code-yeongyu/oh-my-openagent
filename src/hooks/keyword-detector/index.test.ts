import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import * as sessionState from "../../features/claude-code-session-state"
import { _resetForTesting, clearSessionAgent, setMainSession, updateSessionAgent } from "../../features/claude-code-session-state"
import { ContextCollector } from "../../features/context-injector"
import * as sharedModule from "../../shared"
import { createKeywordDetectorHook } from "./index"

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
    expect(textPart?.text).toContain("---")
    expect(textPart?.text).toContain("do something")
    expect(textPart?.text).toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
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
    expect(textPart?.text).toContain("---")
    expect(textPart?.text).toContain("for the bug")
    expect(textPart?.text).toContain("[search-mode]")
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
    expect(textPart?.text).toBe("just a normal message")
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

    // then - ultrawork should still work (variant set to max)
    expect(output.message.variant).toBe("max")
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

    // then - all keywords should work
    expect(output.message.variant).toBe("max")
    expect(toastCalls).toContain("Ultrawork Mode Activated")
  })

  test("should not override existing variant", async () => {
    // given - main session set with pre-existing variant
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

    // then - existing variant should remain
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

    // then - ultrawork should be triggered
    expect(output.message.variant).toBe("max")
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
    expect(textPart?.text).not.toContain("[search-mode]")
    expect(textPart?.text).toContain("<system-reminder>")
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
    expect(textPart?.text).not.toContain("[analyze-mode]")
    expect(textPart?.text).toContain("<system-reminder>")
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
    expect(textPart?.text).toContain("[search-mode]")
    expect(textPart?.text).toContain("Please search for the bug in the code.")
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
    expect(textPart?.text).not.toContain("[search-mode]")
    expect(textPart?.text).not.toContain("[analyze-mode]")
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
    expect(textPart?.text).not.toContain("[search-mode]")
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
    expect(textPart?.text).not.toContain("[search-mode]")
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

  test("should skip ultrawork injection when agent is oracle", async () => {
    // given - collector and oracle agent
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "oracle-session"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork plan this feature" }],
    }

    // when - ultrawork keyword detected with oracle agent
    await hook["chat.message"]({ sessionID, agent: "oracle" }, output)

    // then - ultrawork should be skipped for planner agents, text unchanged
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart?.text).toBe("ultrawork plan this feature")
    expect(textPart?.text).not.toContain("YOU ARE A PLANNER, NOT AN IMPLEMENTER")
    expect(textPart?.text).not.toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
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
    await hook["chat.message"]({ sessionID, agent: "Oracle (Planner)" }, output)

    // then - ultrawork should be skipped, text unchanged
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart?.text).toBe("ulw create a work plan")
    expect(textPart?.text).not.toContain("YOU ARE A PLANNER, NOT AN IMPLEMENTER")
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
    expect(textPart?.text).toBe("ultrawork draft a plan")
    expect(textPart?.text).not.toContain("YOU ARE A PLANNER, NOT AN IMPLEMENTER")
  })

  test("should use normal ultrawork message when agent is Morpheus", async () => {
    // given - collector and Morpheus agent
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "morpheus-session"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork implement this feature" }],
    }

    // when - ultrawork keyword detected with Morpheus agent
    await hook["chat.message"]({ sessionID, agent: "morpheus" }, output)

    // then - should use normal ultrawork message with agent utilization instructions
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart?.text).toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
    expect(textPart?.text).not.toContain("YOU ARE A PLANNER, NOT AN IMPLEMENTER")
    expect(textPart?.text).toContain("---")
    expect(textPart?.text).toContain("implement this feature")
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
    expect(textPart?.text).toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
    expect(textPart?.text).not.toContain("YOU ARE A PLANNER, NOT AN IMPLEMENTER")
    expect(textPart?.text).toContain("---")
    expect(textPart?.text).toContain("do something")
  })

  test("should skip ultrawork for oracle but inject for morpheus", async () => {
    // given - two sessions, one with oracle, one with morpheus
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)

    // First session with oracle
    const oracleSessionID = "oracle-first"
    const oracleOutput = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork plan" }],
    }
    await hook["chat.message"]({ sessionID: oracleSessionID, agent: "oracle" }, oracleOutput)

    // Second session with morpheus
    const morpheusSessionID = "morpheus-second"
    const morpheusOutput = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork implement" }],
    }
    await hook["chat.message"]({ sessionID: morpheusSessionID, agent: "morpheus" }, morpheusOutput)

    // then - oracle should have no injection, morpheus should have normal ultrawork
    const oracleTextPart = oracleOutput.parts.find(p => p.type === "text")
    expect(oracleTextPart?.text).toBe("ultrawork plan")

    const morpheusTextPart = morpheusOutput.parts.find(p => p.type === "text")
    expect(morpheusTextPart?.text).toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
    expect(morpheusTextPart?.text).toContain("---")
    expect(morpheusTextPart?.text).toContain("implement")
  })

  //#given ultrawork mode activated for default model
  //#when the ultrawork message is generated
  //#then it contains "MANDATORY: ACCEPTANCE CRITERIA DEFINITION" section
  test("should contain MANDATORY ACCEPTANCE CRITERIA DEFINITION section in default ultrawork message", async () => {
    // given - collector with no agent specified (default model)
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "ac-test-session"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork implement feature" }],
    }

    // when - ultrawork keyword detected
    await hook["chat.message"]({ sessionID }, output)

    // then - should contain mandatory acceptance criteria section
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart?.text).toContain("MANDATORY: ACCEPTANCE CRITERIA DEFINITION")
    expect(textPart?.text).toContain("BEFORE writing ANY code, you MUST output an Acceptance Criteria block")
    expect(textPart?.text).toContain("FAILURE TO OUTPUT ACCEPTANCE CRITERIA")
    expect(textPart?.text).toContain("Verification Commands")
  })

  //#given ultrawork mode activated for default model
  //#when the ultrawork message is generated
  //#then it contains "MANDATORY: QA EXECUTION" section
  test("should contain MANDATORY QA EXECUTION section in default ultrawork message", async () => {
    // given - collector with no agent specified (default model)
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "qa-test-session"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork implement feature" }],
    }

    // when - ultrawork keyword detected
    await hook["chat.message"]({ sessionID }, output)

    // then - should contain mandatory QA execution section
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart?.text).toContain("MANDATORY: QA EXECUTION")
    expect(textPart?.text).toContain("AFTER implementation, you MUST execute ALL verification commands")
    expect(textPart?.text).toContain("QA Report")
    expect(textPart?.text).toContain("NO EVIDENCE = NOT VERIFIED = NOT DONE")
  })

  //#given ultrawork mode activated for GPT model
  //#when the ultrawork message is generated
  //#then it contains acceptance criteria and QA sections
  test("should contain acceptance criteria and QA sections in GPT ultrawork message", async () => {
    // given - collector with GPT model
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "gpt-qa-test-session"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork implement feature" }],
    }

    // when - ultrawork keyword detected with GPT model
    await hook["chat.message"](
      { sessionID, model: { providerID: "openai", modelID: "openai/gpt-5.2" } },
      output
    )

    // then - should contain both acceptance criteria and QA sections
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart?.text).toContain("MANDATORY: ACCEPTANCE CRITERIA DEFINITION")
    expect(textPart?.text).toContain("MANDATORY: QA EXECUTION")
    expect(textPart?.text).toContain("QA Report")
    expect(textPart?.text).toContain("NO EVIDENCE = NOT VERIFIED = NOT DONE")
  })

  test("should use session state agent over stale input.agent (bug fix)", async () => {
    // given - same session, agent switched from oracle to morpheus in session state
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "same-session-agent-switch"

    // Simulate: session state was updated to morpheus (by index.ts updateSessionAgent)
    updateSessionAgent(sessionID, "morpheus")

    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork implement this" }],
    }

    // when - hook receives stale input.agent="oracle" but session state says "Morpheus"
    await hook["chat.message"]({ sessionID, agent: "oracle" }, output)

    // then - should use Morpheus from session state, NOT oracle from stale input
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart?.text).toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
    expect(textPart?.text).not.toContain("YOU ARE A PLANNER, NOT AN IMPLEMENTER")
    expect(textPart?.text).toContain("---")
    expect(textPart?.text).toContain("implement this")

    // cleanup
    clearSessionAgent(sessionID)
  })

  test("should fall back to input.agent when session state is empty and skip ultrawork for oracle", async () => {
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

    // when - hook receives input.agent="oracle" with no session state
    await hook["chat.message"]({ sessionID, agent: "oracle" }, output)

    // then - oracle fallback from input.agent, ultrawork skipped
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart?.text).toBe("ultrawork plan this")
    expect(textPart?.text).not.toContain("YOU ARE A PLANNER, NOT AN IMPLEMENTER")
  })
})
