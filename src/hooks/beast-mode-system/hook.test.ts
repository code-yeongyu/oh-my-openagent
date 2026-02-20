import { describe, expect, test } from "bun:test"
import { clearSessionModel, setSessionModel } from "../../shared/session-model-state"
import { createBeastModeSystemHook, BEAST_MODE_SYSTEM_PROMPT } from "./hook"

describe("beast-mode-system hook", () => {
  test("injects beast mode prompt for copilot gpt-4.1", async () => {
    //#given
    const sessionID = "ses_beast"
    setSessionModel(sessionID, { providerID: "github-copilot", modelID: "gpt-4.1" })
    const hook = createBeastModeSystemHook()
    const output = { system: [] as string[] }

    //#when
    await hook["experimental.chat.system.transform"]?.({ sessionID }, output)

    //#then
    expect(output.system[0]).toContain("Beast Mode")
    expect(output.system[0]).toContain(BEAST_MODE_SYSTEM_PROMPT.trim().slice(0, 20))

    clearSessionModel(sessionID)
  })

  test("does not inject for other models", async () => {
    //#given
    const sessionID = "ses_no_beast"
    setSessionModel(sessionID, { providerID: "quotio", modelID: "gpt-5.3-codex" })
    const hook = createBeastModeSystemHook()
    const output = { system: [] as string[] }

    //#when
    await hook["experimental.chat.system.transform"]?.({ sessionID }, output)

    //#then
    expect(output.system.length).toBe(0)

    clearSessionModel(sessionID)
  })

  test("avoids duplicate insertion", async () => {
    //#given
    const sessionID = "ses_dupe"
    setSessionModel(sessionID, { providerID: "github-copilot", modelID: "gpt-4.1" })
    const hook = createBeastModeSystemHook()
    const output = { system: [BEAST_MODE_SYSTEM_PROMPT] }

    //#when
    await hook["experimental.chat.system.transform"]?.({ sessionID }, output)

    //#then
    expect(output.system.length).toBe(1)

    clearSessionModel(sessionID)
  })
})
