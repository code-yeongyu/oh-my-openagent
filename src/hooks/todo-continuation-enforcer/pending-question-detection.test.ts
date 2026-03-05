/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"

import { hasUnansweredQuestion } from "./pending-question-detection"

describe("hasUnansweredQuestion", () => {
  test("given empty messages, returns false", () => {
    expect(hasUnansweredQuestion([])).toBe(false)
  })

  test("given null-ish input, returns false", () => {
    expect(hasUnansweredQuestion(undefined as never)).toBe(false)
  })

  test("given last assistant message with question tool_use, returns true", () => {
    const messages = [
      { info: { role: "user" } },
      {
        info: { role: "assistant" },
        parts: [
          { type: "tool_use", name: "question" },
        ],
      },
    ]
    expect(hasUnansweredQuestion(messages)).toBe(true)
  })

  test("given last assistant message with question tool-invocation, returns true", () => {
    const messages = [
      { info: { role: "user" } },
      {
        info: { role: "assistant" },
        parts: [
          { type: "tool-invocation", toolName: "question" },
        ],
      },
    ]
    expect(hasUnansweredQuestion(messages)).toBe(true)
  })

  test("given user message after question (answered), returns false", () => {
    const messages = [
      {
        info: { role: "assistant" },
        parts: [
          { type: "tool_use", name: "question" },
        ],
      },
      { info: { role: "user" } },
    ]
    expect(hasUnansweredQuestion(messages)).toBe(false)
  })

  test("given assistant message with non-question tool, returns false", () => {
    const messages = [
      { info: { role: "user" } },
      {
        info: { role: "assistant" },
        parts: [
          { type: "tool_use", name: "bash" },
        ],
      },
    ]
    expect(hasUnansweredQuestion(messages)).toBe(false)
  })

  test("given assistant message with no parts, returns false", () => {
    const messages = [
      { info: { role: "user" } },
      { info: { role: "assistant" } },
    ]
    expect(hasUnansweredQuestion(messages)).toBe(false)
  })

  test("given role on message directly (not in info), returns true for question", () => {
    const messages = [
      { role: "user" },
      {
        role: "assistant",
        parts: [
          { type: "tool_use", name: "question" },
        ],
      },
    ]
    expect(hasUnansweredQuestion(messages)).toBe(true)
  })

  test("given mixed tools including question, returns true", () => {
    const messages = [
      {
        info: { role: "assistant" },
        parts: [
          { type: "tool_use", name: "bash" },
          { type: "tool_use", name: "question" },
        ],
      },
    ]
    expect(hasUnansweredQuestion(messages)).toBe(true)
  })
})
