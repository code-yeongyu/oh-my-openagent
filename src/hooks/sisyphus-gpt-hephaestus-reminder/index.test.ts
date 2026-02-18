import { describe, expect, spyOn, test } from "bun:test"
import { _resetForTesting, updateSessionAgent } from "../../features/claude-code-session-state"
import { getAgentDisplayName } from "../../shared/agent-display-names"
import { createSisyphusGptHephaestusReminderHook } from "./index"

const SISYPHUS_DISPLAY = getAgentDisplayName("sisyphus")
const HEPHAESTUS_DISPLAY = getAgentDisplayName("hephaestus")

describe("sisyphus-gpt-hephaestus-reminder hook", () => {
  test("shows toast on every chat.message when sisyphus uses gpt model", async () => {
    // given - sisyphus (display name) with gpt model
    const showToast = spyOn({ fn: async () => ({}) }, "fn")
    const hook = createSisyphusGptHephaestusReminderHook({
      client: { tui: { showToast } },
    } as any)

    // when - chat.message is called repeatedly with display name
    await hook["chat.message"]?.({
      sessionID: "ses_1",
      agent: SISYPHUS_DISPLAY,
      model: { providerID: "openai", modelID: "gpt-5.3-codex" },
    })
    await hook["chat.message"]?.({
      sessionID: "ses_1",
      agent: SISYPHUS_DISPLAY,
      model: { providerID: "openai", modelID: "gpt-5.3-codex" },
    })

    // then - toast is shown for every message
    expect(showToast).toHaveBeenCalledTimes(2)
    expect(showToast.mock.calls[0]?.[0]).toMatchObject({
      body: {
        title: "NEVER Use Sisyphus with GPT",
        message: expect.stringContaining("burning money"),
        variant: "error",
      },
    })
  })

  test("does not show toast for non-gpt model", async () => {
    // given - sisyphus with claude model
    const showToast = spyOn({ fn: async () => ({}) }, "fn")
    const hook = createSisyphusGptHephaestusReminderHook({
      client: { tui: { showToast } },
    } as any)

    // when - chat.message runs
    await hook["chat.message"]?.({
      sessionID: "ses_2",
      agent: SISYPHUS_DISPLAY,
      model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
    })

    // then - no toast
    expect(showToast).toHaveBeenCalledTimes(0)
  })

  test("does not show toast for non-sisyphus agent", async () => {
    // given - hephaestus with gpt model
    const showToast = spyOn({ fn: async () => ({}) }, "fn")
    const hook = createSisyphusGptHephaestusReminderHook({
      client: { tui: { showToast } },
    } as any)

    // when - chat.message runs
    await hook["chat.message"]?.({
      sessionID: "ses_3",
      agent: HEPHAESTUS_DISPLAY,
      model: { providerID: "openai", modelID: "gpt-5.2" },
    })

    // then - no toast
    expect(showToast).toHaveBeenCalledTimes(0)
  })

  test("uses session agent fallback when input agent is missing", async () => {
    // given - session agent saved with display name (as OpenCode stores it)
    _resetForTesting()
    updateSessionAgent("ses_4", SISYPHUS_DISPLAY)
    const showToast = spyOn({ fn: async () => ({}) }, "fn")
    const hook = createSisyphusGptHephaestusReminderHook({
      client: { tui: { showToast } },
    } as any)

    // when - chat.message runs without input.agent
    await hook["chat.message"]?.({
      sessionID: "ses_4",
      model: { providerID: "openai", modelID: "gpt-5.2" },
    })

    // then - toast shown via session-agent fallback
    expect(showToast).toHaveBeenCalledTimes(1)
  })
})
