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

async function runHandler(messages: TestMessage[]): Promise<void> {
  const handler = createMessagesTransformHandler({ hooks: {} })
  await handler({}, { messages })
}

describe("messages transform assistant prefill alias repair", () => {
  test("#given Anthropic-backed alias providers end with a rejecting assistant tail #when messages transform runs #then it appends a synthetic user recovery turn", async () => {
    //#given
    const scenarios: Array<{ name: string; providerID: string; modelID: string }> = [
      {
        name: "opencode anthropic npm alias",
        providerID: "opencode",
        modelID: "claude-opus-4-8",
      },
      {
        name: "opencode go anthropic npm alias",
        providerID: "opencode-go",
        modelID: "claude-opus-4-8",
      },
      {
        name: "opencode zen proxy anthropic npm alias",
        providerID: "opencode-zen-proxy",
        modelID: "claude-sonnet-4.6",
      },
      {
        name: "github copilot claude alias",
        providerID: "github-copilot",
        modelID: "claude-sonnet-4.6",
      },
      {
        name: "github copilot enterprise claude alias",
        providerID: "github-copilot-enterprise",
        modelID: "claude-opus-4.7",
      },
      {
        name: "openrouter anthropic namespace",
        providerID: "openrouter",
        modelID: "anthropic/claude-opus-4.8",
      },
      {
        name: "openrouter tilde anthropic namespace",
        providerID: "openrouter",
        modelID: "~anthropic/claude-sonnet-4.6",
      },
      {
        name: "openrouter scoped anthropic namespace",
        providerID: "openrouter",
        modelID: "@anthropic/claude-opus-4.8",
      },
      {
        name: "openrouter colon anthropic namespace",
        providerID: "openrouter",
        modelID: "anthropic:claude-sonnet-4.6",
      },
      {
        name: "vercel claude alias",
        providerID: "vercel",
        modelID: "claude-sonnet-4.6",
      },
      {
        name: "generic anthropic dotted namespace",
        providerID: "litellm",
        modelID: "anthropic.claude-opus-4-8",
      },
      {
        name: "bedrock anthropic dotted id",
        providerID: "aws-bedrock-anthropic",
        modelID: "us.anthropic.claude-opus-4-8",
      },
    ]

    for (const scenario of scenarios) {
      const messages: TestMessage[] = [
        {
          info: userMessage({
            id: `msg_user_${scenario.providerID}`,
            sessionID: `ses_${scenario.providerID}`,
            providerID: scenario.providerID,
            modelID: scenario.modelID,
          }),
          parts: [textPart({
            id: `part_user_${scenario.providerID}`,
            sessionID: `ses_${scenario.providerID}`,
            messageID: `msg_user_${scenario.providerID}`,
            text: scenario.name,
          })],
        },
        {
          info: assistantMessage({
            id: `msg_assistant_${scenario.providerID}`,
            sessionID: `ses_${scenario.providerID}`,
          }),
          parts: [textPart({
            id: `part_assistant_${scenario.providerID}`,
            sessionID: `ses_${scenario.providerID}`,
            messageID: `msg_assistant_${scenario.providerID}`,
            text: "done",
          })],
        },
      ]

      //#when
      await runHandler(messages)

      //#then
      expect(messages, scenario.name).toHaveLength(3)
      expect(messages.at(-1)?.info, scenario.name).toMatchObject({
        role: "user",
        sessionID: `ses_${scenario.providerID}`,
        agent: "sisyphus",
        model: { providerID: scenario.providerID, modelID: scenario.modelID },
      })
      expect(messages.at(-1)?.parts[0], scenario.name).toMatchObject({
        type: "text",
        text: "[internal] Continue from the previous assistant state.",
        synthetic: true,
      })
    }
  })

  test("#given alias providers with models outside the unsupported Anthropic family #when messages transform runs #then it keeps the assistant tail unchanged", async () => {
    //#given
    const scenarios: Array<{ name: string; providerID: string; modelID: string }> = [
      { name: "opencode non-claude model", providerID: "opencode", modelID: "big-pickle" },
      { name: "opencode older claude model", providerID: "opencode", modelID: "claude-sonnet-4-5" },
      { name: "openrouter non-anthropic namespace", providerID: "openrouter", modelID: "openai/gpt-5.4" },
      { name: "openrouter bare claude-looking id", providerID: "openrouter", modelID: "claude-opus-4-8" },
    ]

    for (const scenario of scenarios) {
      const messages: TestMessage[] = [
        {
          info: userMessage({
            id: `msg_user_${scenario.providerID}`,
            sessionID: `ses_${scenario.providerID}`,
            providerID: scenario.providerID,
            modelID: scenario.modelID,
          }),
          parts: [textPart({
            id: `part_user_${scenario.providerID}`,
            sessionID: `ses_${scenario.providerID}`,
            messageID: `msg_user_${scenario.providerID}`,
            text: scenario.name,
          })],
        },
        {
          info: assistantMessage({
            id: `msg_assistant_${scenario.providerID}`,
            sessionID: `ses_${scenario.providerID}`,
          }),
          parts: [textPart({
            id: `part_assistant_${scenario.providerID}`,
            sessionID: `ses_${scenario.providerID}`,
            messageID: `msg_assistant_${scenario.providerID}`,
            text: "completed assistant answer",
          })],
        },
      ]

      //#when
      await runHandler(messages)

      //#then
      expect(messages, scenario.name).toHaveLength(2)
      expect(messages.at(-1)?.info.role, scenario.name).toBe("assistant")
    }
  })
})
