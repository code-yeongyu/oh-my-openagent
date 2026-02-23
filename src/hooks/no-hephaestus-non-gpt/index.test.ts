import { describe, expect, spyOn, test, beforeEach } from "bun:test"
import { _resetForTesting } from "../../features/claude-code-session-state"
import { getAgentDisplayName } from "../../shared/agent-display-names"
import { createNoHephaestusNonGptHook } from "./index"

const HEPHAESTUS_DISPLAY = getAgentDisplayName("hephaestus")
const SISYPHUS_DISPLAY = getAgentDisplayName("sisyphus")

describe("no-hephaestus-non-gpt hook", () => {
  beforeEach(() => {
    _resetForTesting()
  })

  test("shows warning toast once per session when hephaestus uses non-gpt model", async () => {
    // given - hephaestus with claude model
    const showToast = spyOn({ fn: async () => ({}) }, "fn")
    const hook = createNoHephaestusNonGptHook({
      client: { tui: { showToast } },
    } as any)

    // when - chat.message is called repeatedly
    await hook["chat.message"]?.({
      sessionID: "ses_1",
      agent: HEPHAESTUS_DISPLAY,
      model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
    })
    await hook["chat.message"]?.({
      sessionID: "ses_1",
      agent: HEPHAESTUS_DISPLAY,
      model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
    })

    // then - toast is shown only once (rate-limited), agent is NOT switched
    expect(showToast).toHaveBeenCalledTimes(1)
    expect(showToast.mock.calls[0]?.[0]).toMatchObject({
      body: {
        title: "Recommendation: Use GPT with Hephaestus",
        message: expect.stringContaining("For best results with Claude/Kimi/GLM"),
        variant: "warning",
      },
    })
  })

  test("does not show toast when hephaestus uses gpt model", async () => {
    // given - hephaestus with gpt model
    const showToast = spyOn({ fn: async () => ({}) }, "fn")
    const hook = createNoHephaestusNonGptHook({
      client: { tui: { showToast } },
    } as any)

    // when - chat.message runs
    await hook["chat.message"]?.({
      sessionID: "ses_2",
      agent: HEPHAESTUS_DISPLAY,
      model: { providerID: "openai", modelID: "gpt-5.3-codex" },
    })

    // then - no toast
    expect(showToast).toHaveBeenCalledTimes(0)
  })

  test("does not show toast for non-hephaestus agent", async () => {
    // given - sisyphus with claude model (non-gpt)
    const showToast = spyOn({ fn: async () => ({}) }, "fn")
    const hook = createNoHephaestusNonGptHook({
      client: { tui: { showToast } },
    } as any)

    // when - chat.message runs
    await hook["chat.message"]?.({
      sessionID: "ses_3",
      agent: SISYPHUS_DISPLAY,
      model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
    })

    // then - no toast
    expect(showToast).toHaveBeenCalledTimes(0)
  })

  test("shows toast for different sessions independently", async () => {
    // given - two different sessions
    const showToast = spyOn({ fn: async () => ({}) }, "fn")
    const hook = createNoHephaestusNonGptHook({
      client: { tui: { showToast } },
    } as any)

    // when - chat.message runs for two different sessions
    await hook["chat.message"]?.({
      sessionID: "ses_4",
      agent: HEPHAESTUS_DISPLAY,
      model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
    })
    await hook["chat.message"]?.({
      sessionID: "ses_5",
      agent: HEPHAESTUS_DISPLAY,
      model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
    })

    // then - toast shown once per session (2 total)
    expect(showToast).toHaveBeenCalledTimes(2)
  })

  test("retries toast on failure - session not marked as warned until toast succeeds", async () => {
    // given - toast that fails on first call, succeeds on second
    let callCount = 0
    const showToast = spyOn(
      {
        fn: async () => {
          callCount++
          if (callCount === 1) {
            throw new Error("TUI unavailable")
          }
          return {}
        },
      },
      "fn",
    )
    const hook = createNoHephaestusNonGptHook({
      client: { tui: { showToast } },
    } as any)

    // when - chat.message called twice (first fails, second succeeds)
    await hook["chat.message"]?.({
      sessionID: "ses_retry",
      agent: HEPHAESTUS_DISPLAY,
      model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
    })
    await hook["chat.message"]?.({
      sessionID: "ses_retry",
      agent: HEPHAESTUS_DISPLAY,
      model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
    })

    // then - toast called twice (retry on failure), session only warned after success
    expect(showToast).toHaveBeenCalledTimes(2)

    // and - third call does NOT show toast (session now warned)
    await hook["chat.message"]?.({
      sessionID: "ses_retry",
      agent: HEPHAESTUS_DISPLAY,
      model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
    })
    expect(showToast).toHaveBeenCalledTimes(2) // still 2, not 3
  })
})
