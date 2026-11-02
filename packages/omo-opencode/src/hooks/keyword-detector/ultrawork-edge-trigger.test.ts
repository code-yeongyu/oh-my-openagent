import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"

import { createKeywordDetectorHook } from "./index"
import { _resetForTesting, setMainSession } from "../../features/claude-code-session-state"
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

describe("keyword-detector ultrawork edge trigger", () => {
  beforeEach(() => {
    _resetForTesting()
    setMainSession("main-session")
  })

  afterEach(() => {
    _resetForTesting()
  })

  test("#given greeting text before ulw and surrounding whitespace #when chat.message fires #then ultrawork still activates", async () => {
    // given
    const toastCalls: string[] = []
    const hook = createKeywordDetectorHook(createMockPluginInput(toastCalls))
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: " hi there ulw " }],
    }

    // when
    await hook["chat.message"]({ sessionID: "main-session", agent: "sisyphus" }, output)

    // then
    expect(toastCalls).toContain("Ultrawork Mode Activated")
    expect(output.parts[0]?.text).toContain("<ultrawork-mode>")
    expect(output.parts[0]?.text).toContain(" hi there ulw ")
  })

  test("#given greeting before ulw with a trailing task #when chat.message fires #then ultrawork activates and preserves the task", async () => {
    // given
    const toastCalls: string[] = []
    const hook = createKeywordDetectorHook(createMockPluginInput(toastCalls))
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "hey ulw fix the flaky keyword tests" }],
    }

    // when
    await hook["chat.message"]({ sessionID: "main-session", agent: "sisyphus" }, output)

    // then
    expect(toastCalls).toContain("Ultrawork Mode Activated")
    expect(output.parts[0]?.text).toContain("<ultrawork-mode>")
    expect(output.parts[0]?.text).toContain("hey ulw fix the flaky keyword tests")
  })

  test("#given ulw mentioned in the middle of a sentence #when chat.message fires #then ultrawork still activates", async () => {
    // given
    const toastCalls: string[] = []
    const hook = createKeywordDetectorHook(createMockPluginInput(toastCalls))
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "please ulw fix the flaky keyword tests" }],
    }

    // when
    await hook["chat.message"]({ sessionID: "main-session", agent: "sisyphus" }, output)

    // then
    expect(toastCalls).toContain("Ultrawork Mode Activated")
    expect(output.parts[0]?.text).toContain("please ulw fix the flaky keyword tests")
  })

  test("#given trailing ultrawork reference without punctuation #when chat.message fires #then ultrawork still activates", async () => {
    // given
    const toastCalls: string[] = []
    const hook = createKeywordDetectorHook(createMockPluginInput(toastCalls))
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: "what is ultrawork" }],
    }

    // when
    await hook["chat.message"]({ sessionID: "main-session", agent: "sisyphus" }, output)

    // then
    expect(toastCalls).toContain("Ultrawork Mode Activated")
    expect(output.parts[0]?.text).toContain("what is ultrawork")
  })

  test("#given ulw skill names #when chat.message fires #then ultrawork stays inactive", async () => {
    // given
    const prompts = [
      "ulw-plan",
      "please run ulw-plan for this",
      "ulw-research",
      "please run ULW-RESEARCH for this",
      "ulw-execute",
      "please run ULW-EXECUTE.",
      "ulw-loop",
      "(ULW-LOOP), please",
    ]

    for (const prompt of prompts) {
      const toastCalls: string[] = []
      const hook = createKeywordDetectorHook(createMockPluginInput(toastCalls))
      const output = {
        message: {} as Record<string, unknown>,
        parts: [{ type: "text", text: prompt }],
      }

      // when
      await hook["chat.message"]({ sessionID: "main-session", agent: "sisyphus" }, output)

      // then
      expect(toastCalls).toHaveLength(0)
      expect(output.parts[0]?.text).toBe(prompt)
    }
  })

  test.each([
    "ulw",
    "please use ulw",
    "please use ulw.",
    "(ULW), please",
    "ultrawork",
    "please use ultrawork",
    "please use ultrawork!",
    "(ULTRAWORK), please",
    "use ulw-loop, then ulw",
    "use ulw-execute, then ultrawork.",
  ])("#given bare keyword in %s #when chat.message fires #then ultrawork activates", async (prompt) => {
    // given
    const toastCalls: string[] = []
    const hook = createKeywordDetectorHook(createMockPluginInput(toastCalls))
    const output = {
      message: {} as Record<string, unknown>,
      parts: [{ type: "text", text: prompt }],
    }

    // when
    await hook["chat.message"]({ sessionID: "main-session", agent: "sisyphus" }, output)

    // then
    expect(toastCalls).toContain("Ultrawork Mode Activated")
    expect(output.parts[0]?.text).toContain("<ultrawork-mode>")
    expect(output.parts[0]?.text).toContain(prompt)
  })
})
