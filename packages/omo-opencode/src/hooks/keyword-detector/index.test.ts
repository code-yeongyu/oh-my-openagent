/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import * as sessionState from "../../features/claude-code-session-state"
import { _resetForTesting, clearSessionAgent, setMainSession, updateSessionAgent } from "../../features/claude-code-session-state"
import { ContextCollector } from "../../features/context-injector"
import * as sharedModule from "../../shared"
import { OMO_INTERNAL_INITIATOR_MARKER } from "../../shared/internal-initiator-marker"
import { createKeywordDetectorHook } from "./index"

type ToastOptions = { body: { title: string } }
type OutputPart = { readonly type?: unknown; readonly text?: unknown }
type TextOutputPart = { readonly type: "text"; readonly text: string }

function isTextOutputPart(part: OutputPart): part is TextOutputPart {
  return part.type === "text" && typeof part.text === "string"
}

function expectTextPartText(parts: readonly OutputPart[]): string {
  const textPart = parts.find(isTextOutputPart)
  expect(textPart).toBeDefined()
  return textPart?.text ?? ""
}

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
    experimental_workspace: { register: () => {} },
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
    const text = expectTextPartText(output.parts)
    expect(text).toContain("---")
    expect(text).toContain("do something")
    expect(text).toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
  })

  test("should leave search wording as plain user text", async () => {
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

    // then - search wording should not activate a mode prompt
    const text = expectTextPartText(output.parts)
    expect(text).toBe("search for the bug")
  })

  test("should not prepend mode messages twice when an injected message is processed again", async () => {
    const cases = [
      { prompt: "team mode for this refactor", marker: "[team-mode]" },
      { prompt: "hyperplan the migration", marker: "<hyperplan-mode>" },
      { prompt: "ultrawork fix the flaky suite", marker: "<ultrawork-mode>" },
    ]

    for (const testCase of cases) {
      // given - OpenCode can re-submit an already-mutated message after undo/resend
      const collector = new ContextCollector()
      const sessionID = `idempotent-${testCase.marker}`
      getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
      const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
      const output = {
        message: {} as Record<string, unknown>,
        parts: [{ type: "text", text: testCase.prompt }],
      }

      // when - keyword detection sees the same output twice
      await hook["chat.message"]({ sessionID }, output)
      await hook["chat.message"]({ sessionID }, output)

      // then - the mode prompt remains idempotent
      const text = expectTextPartText(output.parts)
      const markerMatches = text.split(testCase.marker).length - 1
      expect(markerMatches).toBe(1)
      expect(text).toContain(testCase.prompt)

      getMainSessionSpy?.mockRestore()
    }
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
    const text = expectTextPartText(output.parts)
    expect(text).toBe("just a normal message")
  })

  test("should not prepend mode instructions to synthetic team peer messages", async () => {
    // given - team mailbox injection created a synthetic peer message containing plain search wording
    const collector = new ContextCollector()
    const sessionID = "synthetic-peer-message-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{
        type: "text",
        synthetic: true,
        text: '<peer_message from="researcher">search the issue thread and report findings</peer_message>',
      }],
    }

    // when - keyword detection sees the synthetic peer message
    await hook["chat.message"]({ sessionID }, output)

    // then - peer message content is preserved without mode injection
    const text = expectTextPartText(output.parts)
    expect(text).toBe('<peer_message from="researcher">search the issue thread and report findings</peer_message>')
  })

  test("should not prepend mode instructions to internally marked peer messages", async () => {
    // given - an internal peer message contains search wording but is not user intent
    const collector = new ContextCollector()
    const sessionID = "internal-peer-message-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const peerText = `<peer_message from="researcher">search the issue thread</peer_message>\n${OMO_INTERNAL_INITIATOR_MARKER}`
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: peerText }],
    }

    // when
    await hook["chat.message"]({ sessionID }, output)

    // then
    const textPart = output.parts.find((part) => part.type === "text")
    expect(textPart?.text).toBe(peerText)
  })

  test("should only fire ultrawork when enabled_expansions is set to [ultrawork]", async () => {
    // given - allowlist configured to only enable ultrawork
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(
      createMockPluginInput(),
      collector,
      undefined,
      { enabled_expansions: ["ultrawork"] }
    )
    const sessionID = "enabled-expansions-ultrawork-only"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "search for the bug" }],
    }

    // when - keyword detection runs with enabled_expansions restricting to ultrawork
    await hook["chat.message"]({ sessionID }, output)

    // then - search wording remains plain text
    const text = expectTextPartText(output.parts)
    expect(text).toBe("search for the bug")
  })

  test("should ignore removed expansions in allowlist", async () => {
    // given - allowlist configured with no active expansion for analyze wording
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(
      createMockPluginInput(),
      collector,
      undefined,
      { enabled_expansions: [] }
    )
    const sessionID = "enabled-expansions-analyze-only"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "investigate the bug" }],
    }

    // when - keyword detection runs against analyze wording
    await hook["chat.message"]({ sessionID }, output)

    // then - analyze wording should not activate a mode prompt
    const text = expectTextPartText(output.parts)
    expect(text).toBe("investigate the bug")
  })

  test("should block all expansions when enabled_expansions is empty array", async () => {
    // given - empty allowlist (effectively disable all)
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(
      createMockPluginInput(),
      collector,
      undefined,
      { enabled_expansions: [] }
    )
    const sessionID = "enabled-expansions-empty"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork fix the bug" }],
    }

    // when - keyword detection runs with empty enabled_expansions
    await hook["chat.message"]({ sessionID }, output)

    // then - ultrawork should not fire
    const text = expectTextPartText(output.parts)
    expect(text).toBe("ultrawork fix the bug") // no mode injection
  })

  test("should allow both allowlist and denylist to coexist", async () => {
    // given - allowlist enables team, but denylist also blocks team
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(
      createMockPluginInput(),
      collector,
      undefined,
      { enabled_expansions: ["team"], disabled_keywords: ["team"] }
    )
    const sessionID = "enabled-and-disabled-coexist"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "team mode for this bug" }],
    }

    // when - both config fields are set
    await hook["chat.message"]({ sessionID }, output)

    // then - team is allowed by allowlist and blocked by denylist, so no injection
    const text = expectTextPartText(output.parts)
    expect(text).toBe("team mode for this bug")
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

  test("should leave removed keyword wording plain in non-main session", async () => {
    // given - main session is set, different session submits removed keyword wording
    const mainSessionID = "main-123"
    const subagentSessionID = "subagent-456"
    setMainSession(mainSessionID)

    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "find this 찾아줘" }],
    }

    // when - non-main session triggers keyword detection
    await hook["chat.message"](
      { sessionID: subagentSessionID },
      output
    )

    // then - removed keyword wording stays plain
    expect(output.message.variant).toBeUndefined()
    expect(output.parts[0]?.text).toBe("find this 찾아줘")
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

  test("should allow active keywords in main session", async () => {
    // given - main session submits ultrawork keyword
    const mainSessionID = "main-123"
    setMainSession(mainSessionID)

    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork 찾아줘" }],
    }

    // when - main session triggers keyword detection
    await hook["chat.message"](
      { sessionID: mainSessionID },
      output
    )

    // then - active keyword should be detected without forcing a runtime variant
    expect(output.message.variant).toBeUndefined()
    const text = expectTextPartText(output.parts)
    expect(text).toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
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

  test("should keep system-reminder search wording plain", async () => {
    // given - message contains search wording only inside system-reminder tags
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

    // then - text should remain unchanged
    const text = expectTextPartText(output.parts)
    expect(text).toContain("<system-reminder>")
  })

  test("should keep system-reminder analyze wording plain", async () => {
    // given - message contains analyze wording only inside system-reminder tags
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

    // then - text should remain unchanged
    const text = expectTextPartText(output.parts)
    expect(text).toContain("<system-reminder>")
  })

  test("should detect active keywords in user text even when system-reminder is present", async () => {
    // given - message contains both system-reminder and user ultrawork keyword
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

Please ultrawork the bug in the code.`
      }],
    }

    // when - keyword detection runs on mixed content
    await hook["chat.message"]({ sessionID }, output)

    // then - should trigger ultrawork from user text only
    const text = expectTextPartText(output.parts)
    expect(text).toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
    expect(text).toContain("Please ultrawork the bug in the code.")
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

    // then - should not trigger any mode because only plain user text remains
    const text = expectTextPartText(output.parts)
    expect(text).toContain("User message without keywords.")
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

    // then - text should remain unchanged
    const text = expectTextPartText(output.parts)
    expect(text).toContain("<SYSTEM-REMINDER>")
  })

  test("should handle multiline system-reminder content with search wording", async () => {
    // given - system-reminder with multiline content containing various search words
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

    // then - text should remain unchanged
    const text = expectTextPartText(output.parts)
    expect(text).toContain("Commands executed:")
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
    const text = expectTextPartText(output.parts)
    expect(text).toBe("ultrawork plan this feature")
    expect(text).not.toContain("YOU ARE A PLANNER, NOT AN IMPLEMENTER")
    expect(text).not.toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
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
    const text = expectTextPartText(output.parts)
    expect(text).toBe("ulw create a work plan")
    expect(text).not.toContain("YOU ARE A PLANNER, NOT AN IMPLEMENTER")
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
    const text = expectTextPartText(output.parts)
    expect(text).toBe("ultrawork draft a plan")
    expect(text).not.toContain("YOU ARE A PLANNER, NOT AN IMPLEMENTER")
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
    const text = expectTextPartText(output.parts)
    expect(text).toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
    expect(text).not.toContain("YOU ARE A PLANNER, NOT AN IMPLEMENTER")
    expect(text).toContain("---")
    expect(text).toContain("implement this feature")
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
    const text = expectTextPartText(output.parts)
    expect(text).toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
    expect(text).not.toContain("YOU ARE A PLANNER, NOT AN IMPLEMENTER")
    expect(text).toContain("---")
    expect(text).toContain("do something")
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
    const prometheusText = prometheusOutput.parts.find(isTextOutputPart)?.text
    expect(prometheusText).toBe("ultrawork plan")

    const sisyphusText = sisyphusOutput.parts.find(isTextOutputPart)?.text
    expect(sisyphusText).toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
    expect(sisyphusText).toContain("---")
    expect(sisyphusText).toContain("implement")
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
    const text = expectTextPartText(output.parts)
    expect(text).toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
    expect(text).not.toContain("YOU ARE A PLANNER, NOT AN IMPLEMENTER")
    expect(text).toContain("---")
    expect(text).toContain("implement this")

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
    const text = expectTextPartText(output.parts)
    expect(text).toBe("ultrawork plan this")
    expect(text).not.toContain("YOU ARE A PLANNER, NOT AN IMPLEMENTER")
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
    const text = expectTextPartText(output.parts)
    expect(text).toBe("ultrawork search and analyze this code")
  })

  test("should skip all keyword injection for Plan agent", async () => {
    // given - keyword-detector hook with Plan agent
    const collector = new ContextCollector()
    const hook = createKeywordDetectorHook(createMockPluginInput(), collector)
    const sessionID = "plan-session"
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "find this inspect this ultrawork" }],
    }

    // when - keyword detection runs with Plan agent
    await hook["chat.message"]({ sessionID, agent: "Plan" }, output)

    // then - no keywords should be injected for non-OMO Plan agent
    const text = expectTextPartText(output.parts)
    expect(text).toBe("find this inspect this ultrawork")
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
    const text = expectTextPartText(output.parts)
    expect(text).toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
    expect(text).toContain("implement this")
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

    // then - text should remain unchanged
    const text = expectTextPartText(output.parts)
    expect(text).toBe("search this codebase")
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
    return unsafeTestValue<PluginInput>({
      client: {
        tui: {
          showToast: async () => {},
        },
      },
    })
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
    const text = expectTextPartText(output.parts)
    expect(text).toContain("[team-mode]")
    expect(text).toContain("team_create")
    expect(text).toContain("team_task_create")
    expect(text).toContain("team_send_message")
    expect(text).toContain("NEVER substitute with delegate_task")
    expect(text).toContain("for this task")
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
    const text = expectTextPartText(output.parts)
    expect(text).not.toContain("[team-mode]")
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
    const text = expectTextPartText(output.parts)
    expect(text).toBe("team mode please")
    expect(text).not.toContain("[team-mode]")
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

  test("should leave search wording plain without a disable flag", async () => {
    // given - keyword detector with no config
    const sessionID = "search-disabled-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(
      createMockPluginInput(),
      undefined,
      undefined,
      undefined,
    )
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "search for the bug in the code" }],
    }

    // when - search wording is submitted
    await hook["chat.message"]({ sessionID }, output)

    // then - search wording remains plain text
    const text = expectTextPartText(output.parts)
    expect(text).toBe("search for the bug in the code")
  })

  test("should leave analyze wording plain without a disable flag", async () => {
    // given - keyword detector with no config
    const sessionID = "analyze-disabled-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(
      createMockPluginInput(),
      undefined,
      undefined,
      undefined,
    )
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "how to do this" }],
    }

    // when - analyze wording is submitted
    await hook["chat.message"]({ sessionID }, output)

    // then - analyze wording remains plain text
    const text = expectTextPartText(output.parts)
    expect(text).toBe("how to do this")
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
    const text = expectTextPartText(output.parts)
    expect(text).toBe("let's use team mode for this")
    expect(text).not.toContain("[team-mode]")
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
    const text = expectTextPartText(output.parts)
    expect(text).toBe("ultrawork do this task")
    expect(text).not.toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
    expect(toastCalls).not.toContain("Ultrawork Mode Activated")
  })

  test("should leave combined search and analyze wording plain", async () => {
    // given - keyword detector with no config
    const sessionID = "multi-disabled-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(
      createMockPluginInput(),
      undefined,
      undefined,
      undefined,
    )
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "search and analyze the codebase" }],
    }

    // when - search and analyze wording is submitted
    await hook["chat.message"]({ sessionID }, output)

    // then - neither wording activates a mode prompt
    const text = expectTextPartText(output.parts)
    expect(text).toBe("search and analyze the codebase")
  })

  test("should let active keywords through when search and analyze wording is present", async () => {
    // given - keyword detector with an active ultrawork keyword plus removed mode wording
    const sessionID = "partial-disabled-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ultrawork search and analyze the codebase" }],
    }

    // when - active and removed keywords are submitted together
    await hook["chat.message"]({ sessionID }, output)

    // then - ultrawork still injects and removed mode prompts do not
    const text = expectTextPartText(output.parts)
    expect(text).toContain("YOU MUST LEVERAGE ALL AVAILABLE AGENTS")
    expect(text).toContain("search and analyze the codebase")
  })

  test("should leave search wording plain when config is undefined", async () => {
    // given - keyword detector with no config
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

    // when - search wording is submitted with no config
    await hook["chat.message"]({ sessionID }, output)

    // then - search wording remains plain text
    const text = expectTextPartText(output.parts)
    expect(text).toBe("search for the answer")
  })

  test("should leave analyze wording plain when disabled_keywords is an empty array", async () => {
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

    // when - analyze wording is submitted with empty disable list
    await hook["chat.message"]({ sessionID }, output)

    // then - analyze wording remains plain text
    const text = expectTextPartText(output.parts)
    expect(text).toBe("investigate this issue")
  })
})
