import { describe, expect, test } from "bun:test"

import { extractLatestAssistantOutcome, extractLatestAssistantText } from "./assistant-message-extractor"

describe("assistant-message-extractor", () => {
  test("returns plain assistant text from the newest assistant message", () => {
    const text = extractLatestAssistantText([
      { info: { role: "assistant", time: { created: 1 } }, parts: [{ type: "text", text: "old answer" }] },
      { info: { role: "assistant", time: { created: 2 } }, parts: [{ type: "text", text: "new answer" }] },
    ])

    expect(text).toBe("new answer")
  })

  test("prefers answer tags and strips thinking blocks from text parts", () => {
    const text = extractLatestAssistantText([
      {
        info: { role: "assistant", time: { created: 1 } },
        parts: [
          {
            type: "text",
            text: "<think>private image reasoning</think>\n<answer>The chart shows revenue rising.</answer>",
          },
        ],
      },
    ])

    expect(text).toBe("The chart shows revenue rising.")
  })

  test("strips thinking blocks when no answer tag is present", () => {
    const text = extractLatestAssistantText([
      {
        info: { role: "assistant", time: { created: 1 } },
        parts: [{ type: "text", text: "<think>private notes</think>\nVisible result" }],
      },
    ])

    expect(text).toBe("Visible result")
  })

  test("uses reasoning parts when thinking models return no text part", () => {
    const text = extractLatestAssistantText([
      {
        info: { role: "assistant", time: { created: 1 } },
        parts: [{ type: "reasoning", text: "<answer>Detected two warning symbols.</answer>" }],
      },
    ])

    expect(text).toBe("Detected two warning symbols.")
  })

  test("uses reasoning_content when text content is empty", () => {
    const text = extractLatestAssistantText([
      {
        info: { role: "assistant", time: { created: 1 } },
        parts: [{ type: "text", text: "", reasoning_content: "<answer>There are three columns.</answer>" }],
      },
    ])

    expect(text).toBe("There are three columns.")
  })

  test("reads text from structured content arrays", () => {
    const text = extractLatestAssistantText([
      {
        info: { role: "assistant", time: { created: 1 } },
        parts: [{ type: "text", content: [{ type: "text", text: "<answer>Structured answer</answer>" }] }],
      },
    ])

    expect(text).toBe("Structured answer")
  })

  test("preserves error and completion metadata while extracting text", () => {
    const outcome = extractLatestAssistantOutcome([
      {
        info: { role: "assistant", time: { created: 1 } },
        parts: [
          { type: "text", text: "<answer>Recovered result</answer>" },
          { type: "error", error: "ProviderError" },
        ],
      },
    ])

    expect(outcome).toEqual({
      text: "Recovered result",
      errorName: "ProviderError",
      hasAssistant: true,
      completed: true,
    })
  })
})
