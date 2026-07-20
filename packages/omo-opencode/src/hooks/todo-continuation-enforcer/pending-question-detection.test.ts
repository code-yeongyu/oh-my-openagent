/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"

import { OMO_INTERNAL_INITIATOR_MARKER } from "../../shared/internal-initiator-marker"
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

  test("#given last assistant message with OpenCode question tool field #when checking pending question #then returns true", () => {
    const messages = [
      { info: { role: "user" } },
      {
        info: { role: "assistant" },
        parts: [
          { type: "tool", tool: "question" },
        ],
      },
    ]
    expect(hasUnansweredQuestion(messages)).toBe(true)
  })

  test("#given last assistant message with OpenCode ask_user_question tool field #when checking pending question #then returns true", () => {
    const messages = [
      { info: { role: "user" } },
      {
        info: { role: "assistant" },
        parts: [
          { type: "tool", tool: "ask_user_question" },
        ],
      },
    ]
    expect(hasUnansweredQuestion(messages)).toBe(true)
  })

  test("#given completed OpenCode question tool #when checking pending question #then returns false", () => {
    const messages = [
      {
        info: { role: "assistant" },
        parts: [
          { type: "tool", tool: "question", state: { status: "completed" } },
        ],
      },
    ]
    expect(hasUnansweredQuestion(messages)).toBe(false)
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

  test("given synthetic user message after question, still treats question as unanswered", () => {
    const messages = [
      {
        info: { role: "assistant" },
        parts: [
          { type: "tool_use", name: "question" },
        ],
      },
      {
        info: { role: "user" },
        parts: [
          { type: "text", text: "internal continuation", synthetic: true },
        ],
      },
    ]
    expect(hasUnansweredQuestion(messages)).toBe(true)
  })

  test("given internally marked user message after question, still treats question as unanswered", () => {
    const messages = [
      {
        info: { role: "assistant" },
        parts: [
          { type: "tool_use", name: "question" },
        ],
      },
      {
        info: { role: "user" },
        parts: [
          { type: "text", text: `internal continuation\n${OMO_INTERNAL_INITIATOR_MARKER}` },
        ],
      },
    ]
    expect(hasUnansweredQuestion(messages)).toBe(true)
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

  test("#given last assistant message with text ending in question mark #when checking pending question #then returns true (issue #5548)", () => {
    const messages = [
      { info: { role: "user" } },
      {
        info: { role: "assistant" },
        parts: [
          {
            type: "text",
            text: "Please provide the preferred date and time?",
          },
        ],
      },
    ]
    expect(hasUnansweredQuestion(messages)).toBe(true)
  })

  test("#given last assistant message with multi-line text ending in question mark #when checking pending question #then returns true (issue #5548)", () => {
    const messages = [
      { info: { role: "user" } },
      {
        info: { role: "assistant" },
        parts: [
          {
            type: "text",
            text: "I have a couple of questions before I continue.\n\nWhat time works best for you?",
          },
        ],
      },
    ]
    expect(hasUnansweredQuestion(messages)).toBe(true)
  })

  test("#given last assistant message with text NOT ending in question mark #when checking pending question #then returns false (issue #5548)", () => {
    const messages = [
      { info: { role: "user" } },
      {
        info: { role: "assistant" },
        parts: [
          {
            type: "text",
            text: "I am going to start working on this now.",
          },
        ],
      },
    ]
    expect(hasUnansweredQuestion(messages)).toBe(false)
  })

  test("#given last assistant message with both text question and tool #when checking pending question #then returns true (issue #5548)", () => {
    const messages = [
      { info: { role: "user" } },
      {
        info: { role: "assistant" },
        parts: [
          { type: "tool_use", name: "bash" },
          {
            type: "text",
            text: "I checked the calendar. What time works for you?",
          },
        ],
      },
    ]
    expect(hasUnansweredQuestion(messages)).toBe(true)
  })
})
