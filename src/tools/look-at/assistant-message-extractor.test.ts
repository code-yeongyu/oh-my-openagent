import { describe, expect, test } from "bun:test"
import { extractLatestAssistantOutcome, extractLatestAssistantText } from "./assistant-message-extractor"

describe("assistant-message-extractor", () => {
  test("extracts text from top-level role/time message shape", () => {
    const messages = [
      {
        role: "assistant",
        time: { created: 2, completed: 3 },
        parts: [{ type: "text", text: "top-level text" }],
      },
    ]

    expect(extractLatestAssistantText(messages)).toBe("top-level text")
  })

  test("extracts text from nested info.role/info.time message shape", () => {
    const messages = [
      {
        info: {
          role: "assistant",
          time: { created: 2, completed: 3 },
        },
        parts: [{ type: "text", text: "nested text" }],
      },
    ]

    expect(extractLatestAssistantText(messages)).toBe("nested text")
  })

  test("returns assistant error details when response is an empty stub", () => {
    const outcome = extractLatestAssistantOutcome([
      {
        role: "assistant",
        time: { created: 2 },
        error: {
          name: "MessageAbortedError",
          data: { message: "The operation was aborted." },
        },
      },
    ])

    expect(outcome.hasAssistant).toBe(true)
    expect(outcome.completed).toBe(false)
    expect(outcome.text).toBeNull()
    expect(outcome.errorName).toBe("MessageAbortedError")
    expect(outcome.errorMessage).toContain("aborted")
  })
})
