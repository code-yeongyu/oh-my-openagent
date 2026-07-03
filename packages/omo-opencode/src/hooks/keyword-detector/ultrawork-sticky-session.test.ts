import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"

import { createKeywordDetectorHook } from "./index"
import { _resetForTesting, setMainSession, subagentSessions } from "../../features/claude-code-session-state"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

function createMockPluginInput(toastCalls: string[] = []) {
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

function createOutput(text: string) {
  return {
    message: {} as Record<string, unknown>,
    parts: [{ type: "text", text }],
  }
}

describe("keyword-detector ultrawork sticky session", () => {
  beforeEach(() => {
    _resetForTesting()
    setMainSession("main-session")
  })

  afterEach(() => {
    _resetForTesting()
  })

  test("#given a session activated by ulw #when a follow-up omits the keyword #then ultrawork prompt is still injected", async () => {
    const toastCalls: string[] = []
    const hook = createKeywordDetectorHook(createMockPluginInput(toastCalls))

    const firstOutput = createOutput("ulw refactor the auth module")
    await hook["chat.message"]({ sessionID: "main-session", agent: "sisyphus" }, firstOutput)

    const followUpOutput = createOutput("and also add error handling")
    await hook["chat.message"]({ sessionID: "main-session", agent: "sisyphus" }, followUpOutput)

    expect(firstOutput.parts[0]?.text).toContain("ULTRAWORK MODE ENABLED!")
    expect(followUpOutput.parts[0]?.text).toContain("ULTRAWORK MODE ENABLED!")
    expect(followUpOutput.parts[0]?.text).toContain("and also add error handling")
    expect(toastCalls).toEqual(["Ultrawork Mode Activated"])
  })

  test("#given a fresh session without ulw activation #when a message has no keyword #then it remains unchanged", async () => {
    const hook = createKeywordDetectorHook(createMockPluginInput())
    const output = createOutput("and also add error handling")

    await hook["chat.message"]({ sessionID: "main-session", agent: "sisyphus" }, output)

    expect(output.parts[0]?.text).toBe("and also add error handling")
  })

  test("#given a session activated by ulw then marked as a background task #when a follow-up omits the keyword #then sticky injection is suppressed", async () => {
    const hook = createKeywordDetectorHook(createMockPluginInput())

    const firstOutput = createOutput("ulw refactor the auth module")
    await hook["chat.message"]({ sessionID: "main-session", agent: "sisyphus" }, firstOutput)
    subagentSessions.add("main-session")

    const followUpOutput = createOutput("and also add error handling")
    await hook["chat.message"]({ sessionID: "main-session", agent: "sisyphus" }, followUpOutput)

    expect(followUpOutput.parts[0]?.text).toBe("and also add error handling")
  })
})
