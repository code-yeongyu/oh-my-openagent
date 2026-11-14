import { describe, expect, test } from "bun:test"
import { capNotificationResult, finalAssistantText } from "./task-notification-result"

describe("finalAssistantText", () => {
  test("#given a transcript ending in tool-only turns #when reading the result #then it returns the newest assistant text, without synthetic or reasoning parts", () => {
    // given
    const messages = [
      { info: { role: "user" }, parts: [{ type: "text", text: "go" }] },
      {
        info: { role: "assistant" },
        parts: [
          { type: "reasoning", text: "thinking" },
          { type: "text", text: "the answer" },
          { type: "text", text: "injected", synthetic: true },
        ],
      },
      { info: { role: "assistant" }, parts: [{ type: "tool" }] },
    ]

    // when
    const text = finalAssistantText(messages)

    // then
    expect(text).toBe("the answer")
  })

  test("#given no assistant text at all #when reading the result #then it returns undefined", () => {
    expect(finalAssistantText([{ info: { role: "user" }, parts: [{ type: "text", text: "go" }] }])).toBeUndefined()
  })
})

describe("capNotificationResult", () => {
  test("#given a result over the cap #when capping #then it is cut and marked truncated", () => {
    // when
    const capped = capNotificationResult("x".repeat(30), 10)

    // then
    expect(capped.truncated).toBe(true)
    expect(capped.text.startsWith("x".repeat(10))).toBe(true)
    expect(capped.text).toContain("20 more characters")
  })

  test("#given a result within the cap #when capping #then it is returned whole", () => {
    expect(capNotificationResult("short", 10)).toEqual({ text: "short", truncated: false })
  })
})
