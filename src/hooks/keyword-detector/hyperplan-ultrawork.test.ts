import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { createKeywordDetectorHook } from "./index"
import { setMainSession, _resetForTesting } from "../../features/claude-code-session-state"
import * as sharedModule from "../../shared"
import * as sessionState from "../../features/claude-code-session-state"

describe("keyword-detector hyperplan-ultrawork combo", () => {
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

  test("should inject combo message when user types 'hpp ulw' (forward order)", async () => {
    // given - main session with adjacent forward-order combo keywords
    const sessionID = "combo-forward-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "hpp ulw refactor the auth module" }],
    }

    // when - keyword detection runs
    await hook["chat.message"]({ sessionID }, output)

    // then - combo banner and embedded ultrawork content both present
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("<hyperplan-ultrawork-mode>")
    expect(textPart!.text).toContain("<ultrawork-mode>")
    expect(textPart!.text).toContain("refactor the auth module")
  })

  test("should inject combo message when user types 'ulw hpp' (reverse order)", async () => {
    // given - main session with adjacent reverse-order combo keywords
    const sessionID = "combo-reverse-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "ulw hpp ship this feature" }],
    }

    // when - keyword detection runs
    await hook["chat.message"]({ sessionID }, output)

    // then - combo fires identically regardless of word order
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("<hyperplan-ultrawork-mode>")
    expect(textPart!.text).toContain("<ultrawork-mode>")
    expect(textPart!.text).toContain("ship this feature")
  })

  test("should NOT trigger combo on non-adjacent 'hpp do ulw' but fire both standalones instead", async () => {
    // given - keywords separated by another word block adjacency requirement
    const sessionID = "combo-non-adjacent-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "hpp do ulw stuff" }],
    }

    // when - keyword detection runs
    await hook["chat.message"]({ sessionID }, output)

    // then - combo absent, both standalone banners injected separately
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).not.toContain("<hyperplan-ultrawork-mode>")
    expect(textPart!.text).toContain("<hyperplan-mode>")
    expect(textPart!.text).toContain("<ultrawork-mode>")
  })

  test("should suppress standalone messages when combo fires (only ONE banner injected)", async () => {
    // given - combo keywords that would also match standalone patterns
    const sessionID = "combo-suppress-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "hpp ulw build" }],
    }

    // when - keyword detection runs
    await hook["chat.message"]({ sessionID }, output)

    // then - only combo banner present, standalone hyperplan suppressed, ultrawork content appears once via embed
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("<hyperplan-ultrawork-mode>")
    expect(textPart!.text).not.toContain("<hyperplan-mode>")
    const ultraworkMatches = textPart!.text!.match(/<ultrawork-mode>/g) ?? []
    expect(ultraworkMatches).toHaveLength(1)
  })

  test("should fire combo toast and suppress standalone toasts", async () => {
    // given - combo keywords with toast tracking
    const sessionID = "combo-toast-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const toastCalls: string[] = []
    const hook = createKeywordDetectorHook(createMockPluginInput({ toastCalls }))
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "hpp ulw do it" }],
    }

    // when - combo fires
    await hook["chat.message"]({ sessionID }, output)

    // then - only combo toast title is shown, standalone toasts suppressed
    expect(toastCalls).toContain("Hyperplan Ultrawork Mode Activated")
    expect(toastCalls).not.toContain("Ultrawork Mode Activated")
    expect(toastCalls).not.toContain("Hyperplan Mode Activated")
  })

  test("should disable combo only when disabled_keywords includes 'hyperplan-ultrawork' (standalones still fire)", async () => {
    // given - combo keyword disabled but standalones remain enabled
    const sessionID = "combo-disabled-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(
      createMockPluginInput(),
      undefined,
      undefined,
      { disabled_keywords: ["hyperplan-ultrawork"] },
    )
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "hpp ulw work it" }],
    }

    // when - keyword detection runs with combo disabled
    await hook["chat.message"]({ sessionID }, output)

    // then - combo absent, both individual standalones still match and inject
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).not.toContain("<hyperplan-ultrawork-mode>")
    expect(textPart!.text).toContain("<hyperplan-mode>")
    expect(textPart!.text).toContain("<ultrawork-mode>")
  })

  test("should block combo via intersection rule when disabled_keywords includes 'ultrawork'", async () => {
    // given - ultrawork standalone disabled, intersection rule cascades to combo
    const sessionID = "combo-intersection-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const toastCalls: string[] = []
    const hook = createKeywordDetectorHook(
      createMockPluginInput({ toastCalls }),
      undefined,
      undefined,
      { disabled_keywords: ["ultrawork"] },
    )
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "hpp ulw plan stuff" }],
    }

    // when - combo would match but is blocked via intersection
    await hook["chat.message"]({ sessionID }, output)

    // then - no combo, no ultrawork content leaks; standalone hyperplan still fires
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).not.toContain("<hyperplan-ultrawork-mode>")
    expect(textPart!.text).not.toContain("<ultrawork-mode>")
    expect(textPart!.text).toContain("<hyperplan-mode>")
    expect(toastCalls).not.toContain("Hyperplan Ultrawork Mode Activated")
    expect(toastCalls).not.toContain("Ultrawork Mode Activated")
  })

  test("should allow combo in non-main session (passes through like standalone ultrawork)", async () => {
    // given - main session set, different (subagent) session triggers combo
    const mainSessionID = "main-combo"
    const subagentSessionID = "subagent-combo"
    setMainSession(mainSessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "hpp ulw run this" }],
    }

    // when - subagent session triggers combo
    await hook["chat.message"]({ sessionID: subagentSessionID }, output)

    // then - combo banner reaches non-main session (whitelisted alongside standalone ultrawork)
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("<hyperplan-ultrawork-mode>")
    expect(textPart!.text).toContain("<ultrawork-mode>")
    expect(textPart!.text).toContain("run this")
  })

  test("should filter combo when agent is prometheus (planner)", async () => {
    // given - planner agent receives a combo prompt
    const sessionID = "combo-prometheus-session"
    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "hpp ulw plan stuff" }],
    }

    // when - planner-agent path filters all execution-mode keywords
    await hook["chat.message"]({ sessionID, agent: "prometheus" }, output)

    // then - text untouched: combo, ultrawork, and hyperplan all filtered for planner
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toBe("hpp ulw plan stuff")
    expect(textPart!.text).not.toContain("<hyperplan-ultrawork-mode>")
    expect(textPart!.text).not.toContain("<ultrawork-mode>")
    expect(textPart!.text).not.toContain("<hyperplan-mode>")
  })

  test("should reuse ultrawork variant: combo with GPT model embeds GPT ultrawork content", async () => {
    // given - GPT-5.4 model selects the GPT ultrawork variant inside the combo banner
    const sessionID = "combo-gpt-variant-session"
    getMainSessionSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue(sessionID)
    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "hpp ulw build feature" }],
    }

    // when - combo fires with GPT model resolved
    await hook["chat.message"](
      { sessionID, agent: "sisyphus", model: { providerID: "openai", modelID: "gpt-5.4" } },
      output,
    )

    // then - combo banner present and GPT-variant ultrawork content embedded (output_verbosity_spec is GPT-only)
    const textPart = output.parts.find(p => p.type === "text")
    expect(textPart).toBeDefined()
    expect(textPart!.text).toContain("<hyperplan-ultrawork-mode>")
    expect(textPart!.text).toContain("<output_verbosity_spec>")
  })
})
