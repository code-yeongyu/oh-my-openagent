import { describe, expect, test, spyOn } from "bun:test"
import { createSisyphusGptHephaestusReminderHook } from "./index"
import { _resetForTesting, updateSessionAgent } from "../../features/claude-code-session-state"

describe("sisyphus-gpt-hephaestus-reminder hook", () => {
  test("shows error toast when sisyphus uses gpt model", async () => {
    // given - sisyphus agent with gpt model
    const showToast = spyOn({
      fn: async () => ({}),
    }, "fn")
    const hook = createSisyphusGptHephaestusReminderHook({
      client: {
        tui: { showToast },
      },
    } as any)

    // when - chat.message runs
    await hook["chat.message"]?.({
      sessionID: "ses_1",
      agent: "sisyphus",
      model: { providerID: "openai", modelID: "gpt-5.3-codex" },
    })

    // then - error toast is shown
    expect(showToast).toHaveBeenCalledTimes(1)
    expect(showToast.mock.calls[0]?.[0]).toMatchObject({
      body: {
        title: "Use Hephaestus for GPT Models",
        variant: "error",
      },
    })
  })

  test("does not show toast for non-gpt model", async () => {
    // given - sisyphus agent with non-gpt model
    const showToast = spyOn({
      fn: async () => ({}),
    }, "fn")
    const hook = createSisyphusGptHephaestusReminderHook({
      client: {
        tui: { showToast },
      },
    } as any)

    // when - chat.message runs with claude model
    await hook["chat.message"]?.({
      sessionID: "ses_2",
      agent: "sisyphus",
      model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
    })

    // then - no toast
    expect(showToast).toHaveBeenCalledTimes(0)
  })

  test("uses session agent fallback when input agent is missing", async () => {
    // given - session agent saved as sisyphus
    _resetForTesting()
    updateSessionAgent("ses_3", "sisyphus")
    const showToast = spyOn({
      fn: async () => ({}),
    }, "fn")
    const hook = createSisyphusGptHephaestusReminderHook({
      client: {
        tui: { showToast },
      },
    } as any)

    // when - chat.message runs without input.agent
    await hook["chat.message"]?.({
      sessionID: "ses_3",
      model: { providerID: "openai", modelID: "gpt-5.2" },
    })

    // then - toast shown via fallback agent lookup
    expect(showToast).toHaveBeenCalledTimes(1)
  })
})
