declare const require: (name: string) => any
const { describe, expect, test } = require("bun:test")

import {
  buildAutoContinuePrompt,
  shouldAutoContinueParentSession,
} from "./parent-session-auto-continue"

describe("shouldAutoContinueParentSession", () => {
  test("returns true for legacy internal-marker-only assistant reply", () => {
    const messages = [
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: "\n<!-- OMO_INTERNAL_INITIATOR -->" }],
      },
    ]

    expect(shouldAutoContinueParentSession(messages)).toBe(true)
  })

  test("returns true for reasoning-only assistant reply", () => {
    const messages = [
      {
        info: { role: "assistant" },
        parts: [{ type: "reasoning", text: "Thinking silently..." }],
      },
    ]

    expect(shouldAutoContinueParentSession(messages)).toBe(true)
  })

  test("returns true for service-only assistant reply", () => {
    const messages = [
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: "<system-reminder>\n[ALL BACKGROUND TASKS COMPLETE]\n</system-reminder>\n[OMO_INTERNAL]" }],
      },
    ]

    expect(shouldAutoContinueParentSession(messages)).toBe(true)
  })

  test("returns false for visible assistant text", () => {
    const messages = [
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: "I will read the result now." }],
      },
    ]

    expect(shouldAutoContinueParentSession(messages)).toBe(false)
  })

  test("returns false for tool-calling assistant reply", () => {
    const messages = [
      {
        info: { role: "assistant" },
        parts: [{ type: "tool" }],
      },
    ]

    expect(shouldAutoContinueParentSession(messages)).toBe(false)
  })
})

describe("buildAutoContinuePrompt", () => {
  test("includes completed tasks and background_output guidance", () => {
    const prompt = buildAutoContinuePrompt(
      [
        { id: "bg_1", description: "Task one" },
        { id: "bg_2", description: "Task two" },
      ],
      1,
    )

    expect(prompt).toContain("previous reply contained no user-visible content")
    expect(prompt).toContain("`bg_1`")
    expect(prompt).toContain("`bg_2`")
    expect(prompt).toContain("background_output")
  })
})
