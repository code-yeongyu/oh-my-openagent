import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk"

import { createMessagesTransformHandler } from "./messages-transform"

type TestMessage = {
  info: Message
  parts: Part[]
}

function userMessage(input: {
  id: string
  sessionID: string
  providerID: string
  modelID: string
}): Message {
  return {
    id: input.id,
    sessionID: input.sessionID,
    role: "user",
    time: { created: 1 },
    agent: "sisyphus",
    model: { providerID: input.providerID, modelID: input.modelID },
  }
}

function assistantMessage(input: { id: string; sessionID: string }): Message {
  return {
    id: input.id,
    sessionID: input.sessionID,
    role: "assistant",
    time: { created: 2 },
    parentID: "msg_parent",
    modelID: "test-model",
    providerID: "test-provider",
    mode: "build",
    path: { cwd: "/tmp", root: "/tmp" },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  }
}

function textPart(input: { id: string; sessionID: string; messageID: string; text: string }): Part {
  return {
    id: input.id,
    sessionID: input.sessionID,
    messageID: input.messageID,
    type: "text",
    text: input.text,
  }
}

function assistantTailPayload(): TestMessage[] {
  return [
    {
      info: userMessage({
        id: "msg_user_red",
        sessionID: "ses_red",
        providerID: "opencode",
        modelID: "claude-opus-4-8",
      }),
      parts: [textPart({
        id: "part_user_red",
        sessionID: "ses_red",
        messageID: "msg_user_red",
        text: "red baseline",
      })],
    },
    {
      info: assistantMessage({ id: "msg_assistant_red", sessionID: "ses_red" }),
      parts: [textPart({
        id: "part_assistant_red",
        sessionID: "ses_red",
        messageID: "msg_assistant_red",
        text: "done",
      })],
    },
  ]
}

describe("#given messages transform recovery path", () => {
  test("#when transform runs twice on identical assistant-tail input #then both outputs are byte-identical", async () => {
    //#given
    const handler = createMessagesTransformHandler({ hooks: {} })
    const first = assistantTailPayload()

    //#when
    await handler({}, { messages: first })
    await new Promise((resolve) => setTimeout(resolve, 25))
    const second = assistantTailPayload()
    await handler({}, { messages: second })

    //#then
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })
})
