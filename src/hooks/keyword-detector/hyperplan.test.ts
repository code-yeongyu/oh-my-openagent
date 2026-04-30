import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { createKeywordDetectorHook } from "./index"
import { setMainSession, _resetForTesting } from "../../features/claude-code-session-state"
import * as sharedModule from "../../shared"
import * as sessionState from "../../features/claude-code-session-state"

describe("keyword-detector hyperplan keyword", () => {
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
          showToast: async (opts: { body: { title: string } }) => {
            toastCalls.push(opts.body.title)
          },
        },
      },
    } as unknown as PluginInput
  }

  test("should inject hyperplan message when user types 'hyperplan'", async () => {
    // given - main session typing the full keyword
    const sessionID = "hyperplan-full-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "hyperplan refactor the auth module" }],
    }

    // when - keyword detection runs
    await hook["chat.message"]({ sessionID }, output)

    // then - hyperplan-mode wrapper and skill-loading instruction should be present
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("<hyperplan-mode>")
    expect(textPart!.text).toContain('skill(name="hyperplan")')
    expect(textPart!.text).toContain("HYPERPLAN MODE ENABLED")
    expect(textPart!.text).toContain("refactor the auth module")
    expect(textPart!.text).toContain("---")
  })

  test("should inject hyperplan message when user types 'hpp' shorthand", async () => {
    // given - main session typing the short keyword
    const sessionID = "hyperplan-short-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "hpp how should I structure this feature" }],
    }

    // when - keyword detection runs
    await hook["chat.message"]({ sessionID }, output)

    // then - hyperplan injection should fire
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("<hyperplan-mode>")
    expect(textPart!.text).toContain('skill(name="hyperplan")')
  })

  test("should inject hyperplan message case-insensitively", async () => {
    // given - main session typing in mixed case
    const sessionID = "hyperplan-case-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "HyperPlan something now" }],
    }

    // when - keyword detection runs with mixed case input
    await hook["chat.message"]({ sessionID }, output)

    // then - hyperplan should still fire
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("<hyperplan-mode>")
  })

  test("should NOT trigger hyperplan when 'hpp' is a substring of another word", async () => {
    // given - text contains 'hpp' only as part of larger string with no word boundary
    const sessionID = "hyperplan-substring-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "myhppvar = 1" }],
    }

    // when - keyword detection runs
    await hook["chat.message"]({ sessionID }, output)

    // then - hyperplan should NOT trigger because 'hpp' lacks word boundaries
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toBe("myhppvar = 1")
    expect(textPart!.text).not.toContain("<hyperplan-mode>")
  })

  test("should fire 'Hyperplan Mode Activated' toast when keyword detected", async () => {
    // given - main session and toast tracking
    const sessionID = "hyperplan-toast-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const toastCalls: string[] = []
    const hook = createKeywordDetectorHook(createMockPluginInput({ toastCalls }))
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "hyperplan this task" }],
    }

    // when - hyperplan keyword fires
    await hook["chat.message"]({ sessionID }, output)

    // then - toast title should be present in tracked calls
    expect(toastCalls).toContain("Hyperplan Mode Activated")
  })

  test("should NOT inject hyperplan when disabled_keywords includes 'hyperplan'", async () => {
    // given - keyword detector with hyperplan disabled
    const sessionID = "hyperplan-disabled-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const toastCalls: string[] = []
    const hook = createKeywordDetectorHook(
      createMockPluginInput({ toastCalls }),
      undefined,
      undefined,
      { disabled_keywords: ["hyperplan"] },
    )
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "hyperplan refactor this" }],
    }

    // when - hyperplan keyword would normally fire
    await hook["chat.message"]({ sessionID }, output)

    // then - neither injection nor toast should occur
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toBe("hyperplan refactor this")
    expect(textPart!.text).not.toContain("<hyperplan-mode>")
    expect(toastCalls).not.toContain("Hyperplan Mode Activated")
  })

  test("should filter hyperplan keyword in non-main session (only ultrawork allowed there)", async () => {
    // given - main session set, different (subagent) session triggers hyperplan
    const mainSessionID = "main-hyperplan"
    const subagentSessionID = "subagent-hyperplan"
    setMainSession(mainSessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "hyperplan please" }],
    }

    // when - subagent session triggers hyperplan keyword
    await hook["chat.message"]({ sessionID: subagentSessionID }, output)

    // then - hyperplan injection should be skipped in non-main session
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toBe("hyperplan please")
    expect(textPart!.text).not.toContain("<hyperplan-mode>")
  })

  test("should skip hyperplan injection when agent is prometheus (planner)", async () => {
    // given - hook running with prometheus agent and a prompt that only triggers hyperplan
    const sessionID = "hyperplan-prometheus-session"
    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "hyperplan refactor stuff" }],
    }

    // when - hyperplan keyword detected with prometheus agent
    await hook["chat.message"]({ sessionID, agent: "prometheus" }, output)

    // then - hyperplan should be filtered out for planner agents
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).not.toContain("<hyperplan-mode>")
    expect(textPart!.text).not.toContain('skill(name="hyperplan")')
    expect(textPart!.text).toContain("hyperplan refactor stuff")
  })

  test("should NOT inject hyperplan when user invokes /hyperplan slash command", async () => {
    // given - main session typing the slash command form
    const sessionID = "hyperplan-slash-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const toastCalls: string[] = []
    const hook = createKeywordDetectorHook(createMockPluginInput({ toastCalls }))
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "/hyperplan refactor the auth module" }],
    }

    // when - keyword detection runs on slash-command-prefixed text
    await hook["chat.message"]({ sessionID }, output)

    // then - the slash command path owns the message; keyword detector must not double-inject
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toBe("/hyperplan refactor the auth module")
    expect(textPart!.text).not.toContain("<hyperplan-mode>")
    expect(toastCalls).not.toContain("Hyperplan Mode Activated")
  })

  test("should NOT inject hyperplan when user invokes /hpp shorthand slash command", async () => {
    // given - main session and shorthand slash command
    const sessionID = "hyperplan-slash-shorthand-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "/hpp investigate the build pipeline" }],
    }

    // when - keyword detection runs
    await hook["chat.message"]({ sessionID }, output)

    // then - keyword detector should yield to the slash command system
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toBe("/hpp investigate the build pipeline")
    expect(textPart!.text).not.toContain("<hyperplan-mode>")
  })

  test("should still inject hyperplan when slash appears mid-message (not a slash command)", async () => {
    // given - text contains a slash later but does not start with one
    const sessionID = "hyperplan-mid-slash-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "hyperplan: refactor src/auth/handler.ts" }],
    }

    // when - keyword detection runs on free-form text that mentions hyperplan first
    await hook["chat.message"]({ sessionID }, output)

    // then - hyperplan should still fire (this is a real keyword invocation, not a slash command)
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("<hyperplan-mode>")
  })

  test("should skip hyperplan injection when agent name contains 'planner' token", async () => {
    // given - hook running with planner-named agent and a prompt that only triggers hpp
    const sessionID = "hyperplan-planner-session"
    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "hpp build the feature" }],
    }

    // when - hpp keyword detected with planner agent
    await hook["chat.message"]({ sessionID, agent: "Plan Agent" }, output)

    // then - hyperplan should be filtered out
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).not.toContain("<hyperplan-mode>")
    expect(textPart!.text).not.toContain('skill(name="hyperplan")')
    expect(textPart!.text).toContain("hpp build the feature")
  })
})
