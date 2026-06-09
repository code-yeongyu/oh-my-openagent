import { describe, expect, test } from "bun:test"
import { latestAssistantTurnBlocksInternalPrompt } from "./pending-tool-turn"

describe("latestAssistantTurnBlocksInternalPrompt", () => {
  test("#given completed assistant question tool has no real user answer #when checking prompt safety #then internal prompts stay blocked", () => {
    // given
    const messages = [
      {
        info: {
          role: "user",
          time: { created: 1000 },
        },
        parts: [{ type: "text", text: "start" }],
      },
      {
        info: {
          role: "assistant",
          finish: "tool-calls",
          time: { created: 2000, completed: 3000 },
        },
        parts: [
          {
            type: "tool_use",
            name: "question",
            state: { status: "error" },
          },
        ],
      },
    ]

    // when
    const blocks = latestAssistantTurnBlocksInternalPrompt(messages)

    // then
    expect(blocks).toBe(true)
  })

  test("#given internal wake follows an unanswered question #when checking prompt safety #then the internal wake does not count as an answer", () => {
    // given
    const messages = [
      {
        info: {
          role: "assistant",
          finish: "tool-calls",
          time: { created: 2000, completed: 3000 },
        },
        parts: [
          {
            type: "tool-invocation",
            toolName: "question",
            state: { status: "error" },
          },
        ],
      },
      {
        info: {
          role: "user",
          time: { created: 4000 },
        },
        parts: [{ type: "text", text: "wake\n<!-- OMO_INTERNAL_INITIATOR -->" }],
      },
    ]

    // when
    const blocks = latestAssistantTurnBlocksInternalPrompt(messages)

    // then
    expect(blocks).toBe(true)
  })

  test("#given opencode question tool field has no real user answer #when checking prompt safety #then internal prompts stay blocked", () => {
    // given
    const messages = [
      {
        info: {
          role: "assistant",
          finish: "tool-calls",
          time: { created: 2000, completed: 3000 },
        },
        parts: [
          {
            type: "tool",
            tool: "question",
            state: { status: "error" },
          },
        ],
      },
      {
        info: {
          role: "user",
          time: { created: 4000 },
        },
        parts: [{ type: "text", text: "wake\n<!-- OMO_INTERNAL_INITIATOR -->" }],
      },
    ]

    // when
    const blocks = latestAssistantTurnBlocksInternalPrompt(messages)

    // then
    expect(blocks).toBe(true)
  })

  test("#given opencode ask-user-question tool field has no real user answer #when checking prompt safety #then internal prompts stay blocked", () => {
    // given
    const messages = [
      {
        info: {
          role: "assistant",
          finish: "tool-calls",
          time: { created: 2000, completed: 3000 },
        },
        parts: [
          {
            type: "tool",
            tool: "ask_user_question",
            state: { status: "error" },
          },
        ],
      },
      {
        info: {
          role: "user",
          time: { created: 4000 },
        },
        parts: [{ type: "text", text: "wake\n<!-- OMO_INTERNAL_INITIATOR -->" }],
      },
    ]

    // when
    const blocks = latestAssistantTurnBlocksInternalPrompt(messages)

    // then
    expect(blocks).toBe(true)
  })

  test("#given answered question tool completed #when checking prompt safety #then internal prompts are not blocked by that question", () => {
    // given
    const messages = [
      {
        info: {
          role: "assistant",
          finish: "tool-calls",
          time: { created: 2000, completed: 3000 },
        },
        parts: [
          {
            type: "tool",
            tool: "question",
            state: {
              status: "completed",
              output: "User has answered your questions: \"format\"=\"Flat codex:sess_abc\".",
            },
          },
        ],
      },
    ]

    // when
    const blocks = latestAssistantTurnBlocksInternalPrompt(messages)

    // then
    expect(blocks).toBe(false)
  })

  test("#given real user answer follows a question #when checking prompt safety #then internal prompts are not blocked by that question", () => {
    // given
    const messages = [
      {
        info: {
          role: "assistant",
          finish: "tool-calls",
          time: { created: 2000, completed: 3000 },
        },
        parts: [
          {
            type: "tool_use",
            name: "question",
            state: { status: "error" },
          },
        ],
      },
      {
        info: {
          role: "user",
          time: { created: 4000 },
        },
        parts: [{ type: "text", text: "continue without the question tool" }],
      },
    ]

    // when
    const blocks = latestAssistantTurnBlocksInternalPrompt(messages)

    // then
    expect(blocks).toBe(false)
  })

  test("#given latest message is an internal continuation user turn #when checking prompt safety #then internal prompts stay blocked", () => {
    // given
    const messages = [
      {
        info: {
          role: "assistant",
          finish: "stop",
          time: { created: 1000, completed: 2000 },
        },
        parts: [{ type: "text", text: "working" }],
      },
      {
        info: {
          role: "user",
          time: { created: 3000 },
        },
        parts: [{ type: "text", text: "continue\n<!-- OMO_INTERNAL_INITIATOR -->", synthetic: true }],
      },
    ]

    // when
    const blocks = latestAssistantTurnBlocksInternalPrompt(messages)

    // then
    expect(blocks).toBe(true)
  })

  test("#given internal continuation gets only an empty unknown assistant turn #when checking prompt safety #then internal prompts stay blocked", () => {
    // given
    const messages = [
      {
        info: {
          role: "user",
          time: { created: 1000 },
        },
        parts: [{ type: "text", text: "continue\n<!-- OMO_INTERNAL_INITIATOR -->", synthetic: true }],
      },
      {
        info: {
          role: "assistant",
          finish: "unknown",
          time: { created: 2000, completed: 3000 },
        },
        parts: [
          { type: "step-start" },
          { type: "step-finish", reason: "unknown" },
        ],
      },
    ]

    // when
    const blocks = latestAssistantTurnBlocksInternalPrompt(messages)

    // then
    expect(blocks).toBe(true)
  })

  test("#given internal continuation receives assistant text #when checking prompt safety #then internal prompts are not blocked", () => {
    // given
    const messages = [
      {
        info: {
          role: "user",
          time: { created: 1000 },
        },
        parts: [{ type: "text", text: "continue\n<!-- OMO_INTERNAL_INITIATOR -->", synthetic: true }],
      },
      {
        info: {
          role: "assistant",
          finish: "unknown",
          time: { created: 2000, completed: 3000 },
        },
        parts: [
          { type: "step-start" },
          { type: "text", text: "I will keep working." },
          { type: "step-finish", reason: "unknown" },
        ],
      },
    ]

    // when
    const blocks = latestAssistantTurnBlocksInternalPrompt(messages)

    // then
    expect(blocks).toBe(false)
  })
})
