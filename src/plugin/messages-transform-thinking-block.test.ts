declare const describe: (name: string, fn: () => void) => void
declare const it: (name: string, fn: () => void | Promise<void>) => void
declare const expect: <T>(value: T) => {
  toBe(expected: T): void
}

import type { CreatedHooks } from "../create-hooks"
import { createThinkingBlockValidatorHook } from "../hooks/thinking-block-validator/hook"
import { createToolPairValidatorHook } from "../hooks/tool-pair-validator/hook"
import { createMessagesTransformHandler } from "./messages-transform"

type TestPart = {
  type: string
  id?: string
  toolUseId?: string
  tool_use_id?: string
  name?: string
  content?: Array<{ type: "text"; text: string }>
  text?: string
  thinking?: string
  signature?: string
}

type TestMessage = {
  info: {
    role: "assistant" | "user"
    id?: string
    sessionID?: string
  }
  parts: TestPart[]
}

function createTestHooks(): CreatedHooks {
  return {
    thinkingBlockValidator: createThinkingBlockValidatorHook(),
    toolPairValidator: createToolPairValidatorHook(),
  } as CreatedHooks
}

async function runMessagesTransform(messages: TestMessage[]): Promise<void> {
  const handler = createMessagesTransformHandler({ hooks: createTestHooks() })
  await handler({}, { messages: messages as never })
}

function countThinkingParts(parts: TestPart[]): number {
  return parts.filter((part) => part.type === "thinking" || part.type === "redacted_thinking").length
}

describe("messages transform thinking block integration", () => {
  it("#given a question tool answer and a resumed assistant turn with existing thinking #when messages transform runs #then it keeps one thinking block in that assistant turn", async () => {
    //#given
    const thinkingBeforeQuestion: TestPart = {
      type: "thinking",
      thinking: "ask a clarifying question",
      signature: "sig-before-question",
    }
    const thinkingAfterAnswer: TestPart = {
      type: "thinking",
      thinking: "continue after answer",
      signature: "sig-after-answer",
    }
    const messages = [
      {
        info: { id: "msg_user_prompt", role: "user", sessionID: "ses_question_thinking" },
        parts: [{ type: "text", text: "think, then ask a question" }],
      },
      {
        info: { id: "msg_question", role: "assistant", sessionID: "ses_question_thinking" },
        parts: [thinkingBeforeQuestion, { type: "tool_use", id: "toolu_question", name: "question" }],
      },
      {
        info: { id: "msg_question_answer", role: "user", sessionID: "ses_question_thinking" },
        parts: [
          {
            type: "tool_result",
            toolUseId: "toolu_question",
            tool_use_id: "toolu_question",
            content: [{ type: "text", text: "answer" }],
          },
        ],
      },
      {
        info: { id: "msg_resumed", role: "assistant", sessionID: "ses_question_thinking" },
        parts: [
          { type: "text", text: "resuming" },
          thinkingAfterAnswer,
          { type: "tool_use", id: "toolu_after_answer", name: "bash" },
        ],
      },
    ] satisfies TestMessage[]

    //#when
    await runMessagesTransform(messages)

    //#then
    const resumedMessage = messages.find((message) => message.info.id === "msg_resumed")
    expect(resumedMessage?.parts[1]).toBe(thinkingAfterAnswer)
    expect(countThinkingParts(resumedMessage?.parts ?? [])).toBe(1)
  })

  it("#given prior signed thinking and a latest assistant turn without thinking #when messages transform runs #then it does not copy thinking into the latest turn", async () => {
    //#given
    const priorThinkingPart: TestPart = {
      type: "thinking",
      thinking: "prior plan",
      signature: "sig-prior",
    }
    const latestTextPart: TestPart = { type: "text", text: "continue" }
    const latestToolPart: TestPart = {
      type: "tool_use",
      id: "toolu_latest",
      name: "bash",
    }
    const messages = [
      {
        info: { id: "msg_user", role: "user", sessionID: "ses_latest_preserve" },
        parts: [{ type: "text", text: "start" }],
      },
      {
        info: { id: "msg_prior", role: "assistant", sessionID: "ses_latest_preserve" },
        parts: [priorThinkingPart, { type: "tool_use", id: "toolu_prior", name: "bash" }],
      },
      {
        info: { id: "msg_prior_result", role: "user", sessionID: "ses_latest_preserve" },
        parts: [
          {
            type: "tool_result",
            toolUseId: "toolu_prior",
            tool_use_id: "toolu_prior",
            content: [{ type: "text", text: "done" }],
          },
        ],
      },
      {
        info: { id: "msg_latest", role: "assistant", sessionID: "ses_latest_preserve" },
        parts: [latestTextPart, latestToolPart],
      },
    ] satisfies TestMessage[]

    //#when
    await runMessagesTransform(messages)

    //#then
    const latestMessage = messages.find((message) => message.info.id === "msg_latest")
    expect(latestMessage?.parts[0]).toBe(latestTextPart)
    expect(latestMessage?.parts[1]).toBe(latestToolPart)
    expect(countThinkingParts(latestMessage?.parts ?? [])).toBe(0)
  })
})
