import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { createKeywordDetectorHook } from "./index"
import { setMainSession, _resetForTesting } from "../../features/claude-code-session-state"
import * as sharedModule from "../../shared"
import * as sessionState from "../../features/claude-code-session-state"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

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
    return unsafeTestValue<PluginInput>({
      client: {
        tui: {
          showToast: async (opts: { body: { title: string } }) => {
            toastCalls.push(opts.body.title)
          },
        },
      },
    })
  }

  function textOf(output: { readonly parts: readonly { readonly type: string; readonly text?: string }[] }): string {
    const textPart = output.parts.find((part) => part.type === "text")
    expect(textPart).toBeDefined()
    if (!textPart || typeof textPart.text !== "string") {
      throw new Error("expected text part")
    }
    return textPart.text
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
    const text = textOf(output)
    expect(text).toContain("<hyperplan-mode>")
    expect(text).toContain('skill(name="hyperplan")')
    expect(text).toContain("HYPERPLAN MODE ENABLED")
    expect(text).toContain("unspecified-low")
    expect(text).toContain("unspecified-high")
    expect(text).toContain("artistry")
    expect(text).toContain("ultrabrain")
    expect(text).toContain("deep")
    expect(text).toContain("only if")
    expect(text).toContain("enabled")
    expect(text).toContain("refactor the auth module")
    expect(text).toContain("---")
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
    const text = textOf(output)
    expect(text).toContain("<hyperplan-mode>")
    expect(text).toContain('skill(name="hyperplan")')
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
    const text = textOf(output)
    expect(text).toContain("<hyperplan-mode>")
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
    const text = textOf(output)
    expect(text).toBe("myhppvar = 1")
    expect(text).not.toContain("<hyperplan-mode>")
  })

  test("should NOT trigger hyperplan when 'hpp' is the extension of a C++ header path", async () => {
    // given - text references a .hpp file, which is extremely common in C++ codebases
    const sessionID = "hyperplan-hpp-extension-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "please help to check interface.hpp" }],
    }

    // when - keyword detection runs on a message that only contains 'hpp' as a file extension
    await hook["chat.message"]({ sessionID }, output)

    // then - hyperplan must NOT fire just because '.hpp' appears as a file extension
    const text = textOf(output)
    expect(text).toBe("please help to check interface.hpp")
    expect(text).not.toContain("<hyperplan-mode>")
  })

  test("should NOT trigger hyperplan when path-like '.hpp' appears in a deeper file path", async () => {
    // given - text contains a longer path ending in .hpp (free of other trigger words like 'review')
    const sessionID = "hyperplan-hpp-path-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "open src/include/audio/buffer.hpp and fix the leak" }],
    }

    // when - keyword detection runs
    await hook["chat.message"]({ sessionID }, output)

    // then - hyperplan must not fire (the trailing '.hpp' is a header extension, not the trigger)
    const text = textOf(output)
    expect(text).not.toContain("<hyperplan-mode>")
    expect(text).not.toContain('skill(name="hyperplan")')
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
    const text = textOf(output)
    expect(text).toBe("hyperplan refactor this")
    expect(text).not.toContain("<hyperplan-mode>")
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
    const text = textOf(output)
    expect(text).toBe("hyperplan please")
    expect(text).not.toContain("<hyperplan-mode>")
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
    const text = textOf(output)
    expect(text).not.toContain("<hyperplan-mode>")
    expect(text).not.toContain('skill(name="hyperplan")')
    expect(text).toContain("hyperplan refactor stuff")
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
    const text = textOf(output)
    expect(text).toBe("/hyperplan refactor the auth module")
    expect(text).not.toContain("<hyperplan-mode>")
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
    const text = textOf(output)
    expect(text).toBe("/hpp investigate the build pipeline")
    expect(text).not.toContain("<hyperplan-mode>")
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
    const text = textOf(output)
    expect(text).toContain("<hyperplan-mode>")
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
    const text = textOf(output)
    expect(text).not.toContain("<hyperplan-mode>")
    expect(text).not.toContain('skill(name="hyperplan")')
    expect(text).toContain("hpp build the feature")
  })
})
