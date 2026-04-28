/// <reference types="bun-types" />

import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { createKeywordDetectorHook } from "./index"
import { setMainSession, updateSessionAgent, clearSessionAgent, _resetForTesting } from "../../features/claude-code-session-state"
import { ContextCollector } from "../../features/context-injector"
import * as sharedModule from "../../shared"
import * as sessionState from "../../features/claude-code-session-state"

type ToastOptions = { body: { title: string } }

function createPluginInputWithToast(showToast: (options: ToastOptions) => Promise<void>): PluginInput {
  const client = {} as PluginInput["client"]
  Object.assign(client, { tui: { showToast } })

  return {
    client,
    project: {
      id: "keyword-detector-test-project",
      worktree: "/tmp/keyword-detector-test",
      time: { created: 0 },
    },
    directory: "/tmp/keyword-detector-test",
    worktree: "/tmp/keyword-detector-test",
    serverUrl: new URL("http://localhost"),
    $: {} as PluginInput["$"],
  }
}

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
    return createPluginInputWithToast(async () => {})
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

  test("should tell analyze-mode agents to evaluate skills before delegating", async () => {
    // given - analyze mode keyword detection runs on a user investigation request
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "analyze-skill-guidance-session"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "investigate why subagents miss recovery skills" }],
    }

    // when - analyze mode is injected
    await hook["chat.message"]({ sessionID }, output)

    // then - guidance should require evaluating skills, not hard-code an empty skill list
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("Evaluate available skills before dispatch")
    expect(textPart!.text).toContain("pass [] ONLY when no skill matches")
    expect(textPart!.text).not.toContain("ALWAYS include load_skills=[]")
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
    return createPluginInputWithToast(async (options) => {
      toastCalls.push(options.body.title)
    })
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
    expect(output.message.variant).toBeUndefined()
    expect(output.parts[0]?.text).toBe("search mode 찾아줘")
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
    return createPluginInputWithToast(async (options) => {
      toastCalls.push(options.body.title)
    })
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
    return createPluginInputWithToast(async () => {})
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
    return createPluginInputWithToast(async () => {})
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

describe("keyword-detector non-OMO agent skipping", () => {
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
    return createPluginInputWithToast(async () => {})
  }

  test("should skip all keyword injection for OpenCode-Builder agent", async () => {
    // given - keyword-detector hook with Builder agent
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "builder-session"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork search and analyze this code" }],
    }

    // when - keyword detection runs with OpenCode-Builder agent
    await hook["chat.message"]({ sessionID, agent: "OpenCode-Builder" }, output)

    // then - no keywords should be injected
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toBe("ultrawork search and analyze this code")
  })

  test("should skip all keyword injection for Plan agent", async () => {
    // given - keyword-detector hook with Plan agent
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "plan-session"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "search mode analyze mode ultrawork" }],
    }

    // when - keyword detection runs with Plan agent
    await hook["chat.message"]({ sessionID, agent: "Plan" }, output)

    // then - no keywords should be injected for non-OMO Plan agent
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toBe("search mode analyze mode ultrawork")
  })

  test("should still inject keywords for OMO agents like Sisyphus", async () => {
    // given - keyword-detector hook with Sisyphus agent
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "sisyphus-session-omo"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork implement this" }],
    }

    // when - keyword detection runs with Sisyphus (OMO agent)
    await hook["chat.message"]({ sessionID, agent: "sisyphus" }, output)

    // then - keywords should be injected normally
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
    expect(textPart!.text).toContain("implement this")
  })

  test("should skip keyword injection for agent names containing 'builder'", async () => {
    // given - keyword-detector hook with a builder-variant agent name
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "custom-builder-session"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "search this codebase" }],
    }

    // when - keyword detection runs with a builder-type agent
    await hook["chat.message"]({ sessionID, agent: "Custom-Builder" }, output)

    // then - search-mode should NOT be injected
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toBe("search this codebase")
    expect(textPart!.text).not.toContain("[search-mode]")
  })
})

describe("keyword-detector team mode", () => {
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
    } as unknown as PluginInput
  }

  test("should inject team-mode message when user types 'team mode'", async () => {
    // given - main session typing English 'team mode'
    const collector = new ContextCollector()
    const sessionID = "team-en-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "let's use team mode for this task" }],
    }

    // when - keyword detection runs
    await hook["chat.message"]({ sessionID }, output)

    // then - team-mode message should be prepended with team_* tool guidance
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("[team-mode]")
    expect(textPart!.text).toContain("team_create")
    expect(textPart!.text).toContain("team_task_create")
    expect(textPart!.text).toContain("team_send_message")
    expect(textPart!.text).toContain("NEVER substitute with delegate_task")
    expect(textPart!.text).toContain("for this task")
  })

  test("should inject team-mode message when user types '팀 모드' (Korean with space)", async () => {
    // given - main session typing Korean '팀 모드'
    const collector = new ContextCollector()
    const sessionID = "team-ko-spaced-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "이거 팀 모드로 해줘" }],
    }

    // when - keyword detection runs
    await hook["chat.message"]({ sessionID }, output)

    // then - team-mode message should be prepended
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("[team-mode]")
    expect(textPart!.text).toContain("팀 모드로 해줘")
  })

  test("should inject team-mode message when user types '팀으로'", async () => {
    // given - main session typing Korean '팀으로'
    const collector = new ContextCollector()
    const sessionID = "team-ko-eulo-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "팀으로 일하자" }],
    }

    // when - keyword detection runs
    await hook["chat.message"]({ sessionID }, output)

    // then - team-mode message should be prepended
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("[team-mode]")
    expect(textPart!.text).toContain("팀으로 일하자")
  })

  test("should NOT trigger team-mode on '스팀으로' (false-positive guard)", async () => {
    // given - text contains '팀으로' as substring of another Korean word ('스팀으로')
    const collector = new ContextCollector()
    const sessionID = "false-positive-eulo-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "스팀으로 게임 켜줘" }],
    }

    // when - keyword detection runs
    await hook["chat.message"]({ sessionID }, output)

    // then - team-mode should NOT be triggered, text unchanged
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toBe("스팀으로 게임 켜줘")
    expect(textPart!.text).not.toContain("[team-mode]")
  })

  test("should NOT trigger team-mode on '스팀모드' (Hangul-prefix false-positive guard)", async () => {
    // given - text contains '팀모드' as substring of another Korean word ('스팀모드')
    const collector = new ContextCollector()
    const sessionID = "false-positive-mode-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "스팀모드 활성화" }],
    }

    // when - keyword detection runs
    await hook["chat.message"]({ sessionID }, output)

    // then - team-mode should NOT be triggered
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toBe("스팀모드 활성화")
    expect(textPart!.text).not.toContain("[team-mode]")
  })

  test("should NOT trigger team-mode on bare 'team' without 'mode'", async () => {
    // given - text contains 'team' but not 'team mode'
    const collector = new ContextCollector()
    const sessionID = "bare-team-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "join the team and start working" }],
    }

    // when - keyword detection runs
    await hook["chat.message"]({ sessionID }, output)

    // then - team-mode should NOT be triggered
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).not.toContain("[team-mode]")
  })

  test("should filter team-mode keyword in non-main session (only ultrawork allowed there)", async () => {
    // given - main session set, different (subagent) session triggers team mode
    const mainSessionID = "main-team-mode"
    const subagentSessionID = "subagent-team-mode"
    setMainSession(mainSessionID)

    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "team mode please" }],
    }

    // when - subagent session triggers team mode keyword
    await hook["chat.message"]({ sessionID: subagentSessionID }, output)

    // then - team-mode message should NOT be injected in subagent session
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toBe("team mode please")
    expect(textPart!.text).not.toContain("[team-mode]")
  })
})

describe("keyword-detector disabled_keywords config", () => {
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

  function createMockPluginInput(options: { toastCalls?: string[] } = {}) {
    const toastCalls = options.toastCalls ?? []
    return {
      client: {
        tui: {
          showToast: async (opts: { body: { title: string } }) => {
            toastCalls.push(opts.body.title)
          },
        },
      },
    } as unknown as PluginInput
  }

  test("should NOT inject search-mode when disabled_keywords includes 'search'", async () => {
    // given - keyword detector with search disabled
    const sessionID = "search-disabled-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(
      createMockPluginInput(),
      undefined,
      undefined,
      { disabled_keywords: ["search"] },
    )
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "search for the bug in the code" }],
    }

    // when - search keyword would normally trigger
    await hook["chat.message"]({ sessionID }, output)

    // then - search-mode injection should be skipped
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toBe("search for the bug in the code")
    expect(textPart!.text).not.toContain("[search-mode]")
  })

  test("should NOT inject analyze-mode when disabled_keywords includes 'analyze'", async () => {
    // given - keyword detector with analyze disabled
    const sessionID = "analyze-disabled-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(
      createMockPluginInput(),
      undefined,
      undefined,
      { disabled_keywords: ["analyze"] },
    )
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "how to do this" }],
    }

    // when - analyze keyword would normally trigger
    await hook["chat.message"]({ sessionID }, output)

    // then - analyze-mode injection should be skipped
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toBe("how to do this")
    expect(textPart!.text).not.toContain("[analyze-mode]")
  })

  test("should NOT inject team-mode when disabled_keywords includes 'team'", async () => {
    // given - keyword detector with team disabled
    const sessionID = "team-disabled-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(
      createMockPluginInput(),
      undefined,
      undefined,
      { disabled_keywords: ["team"] },
    )
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "let's use team mode for this" }],
    }

    // when - team keyword would normally trigger
    await hook["chat.message"]({ sessionID }, output)

    // then - team-mode injection should be skipped
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toBe("let's use team mode for this")
    expect(textPart!.text).not.toContain("[team-mode]")
  })

  test("should NOT inject ultrawork message AND not show toast when disabled_keywords includes 'ultrawork'", async () => {
    // given - keyword detector with ultrawork disabled
    const sessionID = "ultrawork-disabled-session"
    const toastCalls: string[] = []
    const hook = createKeywordDetectorHook(
      createMockPluginInput({ toastCalls }),
      undefined,
      undefined,
      { disabled_keywords: ["ultrawork"] },
    )
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork do this task" }],
    }

    // when - ultrawork keyword would normally trigger toast + injection
    await hook["chat.message"]({ sessionID }, output)

    // then - neither toast nor injection should occur
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toBe("ultrawork do this task")
    expect(textPart!.text).not.toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
    expect(toastCalls).not.toContain("Ultrawork Mode Activated")
  })

  test("should disable multiple keywords simultaneously when listed together", async () => {
    // given - keyword detector with both search and analyze disabled
    const sessionID = "multi-disabled-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(
      createMockPluginInput(),
      undefined,
      undefined,
      { disabled_keywords: ["search", "analyze"] },
    )
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "search and analyze the codebase" }],
    }

    // when - both search and analyze would normally fire
    await hook["chat.message"]({ sessionID }, output)

    // then - neither mode should inject
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toBe("search and analyze the codebase")
    expect(textPart!.text).not.toContain("[search-mode]")
    expect(textPart!.text).not.toContain("[analyze-mode]")
  })

  test("should let other keywords through when only one is disabled", async () => {
    // given - keyword detector with only search disabled, but message contains both search and analyze triggers
    const sessionID = "partial-disabled-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(
      createMockPluginInput(),
      undefined,
      undefined,
      { disabled_keywords: ["search"] },
    )
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "search and analyze the codebase" }],
    }

    // when - both keywords match but only search is disabled
    await hook["chat.message"]({ sessionID }, output)

    // then - analyze should still inject, search should be skipped
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).not.toContain("[search-mode]")
    expect(textPart!.text).toContain("[analyze-mode]")
    expect(textPart!.text).toContain("search and analyze the codebase")
  })

  test("should behave normally (all keywords enabled) when config is undefined", async () => {
    // given - keyword detector with no config (regression test for backward compat)
    const sessionID = "no-config-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(
      createMockPluginInput(),
      undefined,
      undefined,
      undefined,
    )
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "search for the answer" }],
    }

    // when - search keyword fires with no config
    await hook["chat.message"]({ sessionID }, output)

    // then - search-mode should inject as usual
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("[search-mode]")
  })

  test("should behave normally when disabled_keywords is an empty array", async () => {
    // given - keyword detector with empty disable list
    const sessionID = "empty-disabled-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(
      createMockPluginInput(),
      undefined,
      undefined,
      { disabled_keywords: [] },
    )
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "investigate this issue" }],
    }

    // when - analyze keyword fires with empty disable list
    await hook["chat.message"]({ sessionID }, output)

    // then - analyze-mode should still inject
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("[analyze-mode]")
  })
})
