import { describe, expect, test } from "bun:test"

import { isLastAssistantMessageAborted } from "./abort-detection"
import type { MessageInfo } from "./types"

function makeAssistantMessage(overrides: Partial<MessageInfo> = {}): { info?: MessageInfo } {
  return { info: { role: "assistant", ...overrides } }
}

function makeUserMessage(): { info?: MessageInfo } {
  return { info: { role: "user" } }
}

describe("isLastAssistantMessageAborted", () => {
  describe("edge cases", () => {
    test("empty messages array returns false", () => {
      expect(isLastAssistantMessageAborted([])).toBe(false)
    })

    test("messages with no assistant role returns false", () => {
      const messages = [makeUserMessage(), makeUserMessage(), makeUserMessage()]
      expect(isLastAssistantMessageAborted(messages)).toBe(false)
    })

    test("messages with undefined info are skipped", () => {
      const messages = [{ info: undefined }, { info: undefined }]
      expect(isLastAssistantMessageAborted(messages)).toBe(false)
    })

    test("null-ish messages returns false", () => {
      expect(isLastAssistantMessageAborted(null as unknown as Array<{ info?: MessageInfo }>)).toBe(
        false,
      )
      expect(
        isLastAssistantMessageAborted(undefined as unknown as Array<{ info?: MessageInfo }>),
      ).toBe(false)
    })
  })

  describe("last assistant message inspection", () => {
    test("last assistant with MessageAbortedError returns true", () => {
      const messages = [
        makeUserMessage(),
        makeAssistantMessage({ error: { name: "SomeOtherError" } }),
        makeAssistantMessage({ error: { name: "MessageAbortedError" } }),
      ]
      expect(isLastAssistantMessageAborted(messages)).toBe(true)
    })

    test("last assistant with AbortError returns true", () => {
      const messages = [
        makeAssistantMessage({ error: { name: "MessageAbortedError" } }),
        makeAssistantMessage({ error: { name: "AbortError" } }),
      ]
      expect(isLastAssistantMessageAborted(messages)).toBe(true)
    })

    test("last assistant with no error returns false", () => {
      const messages = [
        makeAssistantMessage({ error: { name: "MessageAbortedError" } }),
        makeAssistantMessage(),
      ]
      expect(isLastAssistantMessageAborted(messages)).toBe(false)
    })

    test("last assistant with non-abort error returns false", () => {
      const messages = [
        makeAssistantMessage({ error: { name: "RateLimitError" } }),
        makeAssistantMessage({ error: { name: "NetworkError" } }),
      ]
      expect(isLastAssistantMessageAborted(messages)).toBe(false)
    })

    test("user message appended after aborted assistant does not change result", () => {
      const messages = [
        makeAssistantMessage({ error: { name: "MessageAbortedError" } }),
        makeUserMessage(),
      ]
      expect(isLastAssistantMessageAborted(messages)).toBe(true)
    })
  })

  describe("isLastAssistantMessageAborted single backward iteration", () => {
    test("returns correct result for 5 fixture cases (last assistant aborted? true/false edge cases)", () => {
      expect(isLastAssistantMessageAborted([])).toBe(false)

      const noAssistant = [makeUserMessage(), makeUserMessage(), makeUserMessage()]
      expect(isLastAssistantMessageAborted(noAssistant)).toBe(false)

      const messageAborted = [
        makeUserMessage(),
        makeAssistantMessage({ error: { name: "SomeOtherError" } }),
        makeAssistantMessage({ error: { name: "MessageAbortedError" } }),
      ]
      expect(isLastAssistantMessageAborted(messageAborted)).toBe(true)

      const abortError = [
        makeAssistantMessage({ error: { name: "MessageAbortedError" } }),
        makeAssistantMessage({ error: { name: "AbortError" } }),
      ]
      expect(isLastAssistantMessageAborted(abortError)).toBe(true)

      const noError = [
        makeAssistantMessage({ error: { name: "MessageAbortedError" } }),
        makeAssistantMessage(),
      ]
      expect(isLastAssistantMessageAborted(noError)).toBe(false)
    })

    test("completes in <1ms for 1000-message input where the last is an aborted assistant", () => {
      const N = 1000
      const messages: Array<{ info?: MessageInfo }> = []
      for (let i = 0; i < N - 1; i++) {
        messages.push(
          i % 2 === 0
            ? makeUserMessage()
            : makeAssistantMessage({ error: { name: "SomeOtherError" } }),
        )
      }
      messages.push(makeAssistantMessage({ error: { name: "MessageAbortedError" } }))

      const start = performance.now()
      const result = isLastAssistantMessageAborted(messages)
      const elapsedMs = performance.now() - start

      expect(result).toBe(true)
      expect(elapsedMs).toBeLessThan(1)
    })
  })
})
