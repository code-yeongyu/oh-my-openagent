/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"

import {
  AUTO_SLASH_COMMAND_TAG_CLOSE,
  AUTO_SLASH_COMMAND_TAG_OPEN,
} from "../auto-slash-command/constants"
import { OhMyOpenCodeConfigSchema } from "../../config"
import { createMessagesTransformHandler } from "../../plugin/messages-transform"
import { createTransformHooks } from "../../plugin/hooks/create-transform-hooks"
import { BTW_AUTO_SLASH_COMMAND_MARKER } from "./predicates"
import type { PluginContext } from "../../plugin/types"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

type PipelineOutput = Parameters<ReturnType<typeof createMessagesTransformHandler>>[1]
type PipelineMessage = PipelineOutput["messages"][number]

const SESSION_ID = "btw-pipeline-session"
const MODEL = {
  providerID: "fixture-provider",
  modelID: "fixture-model",
}

function createUserMessage(id: string, text: string): PipelineMessage {
  return {
    info: {
      id,
      sessionID: SESSION_ID,
      role: "user",
      time: { created: 0 },
      agent: "fixture-agent",
      model: MODEL,
    },
    parts: [{ id: `${id}-text`, sessionID: SESSION_ID, messageID: id, type: "text", text }],
  }
}

function createAssistantMessage(id: string, text: string): PipelineMessage {
  return {
    info: {
      id,
      sessionID: SESSION_ID,
      role: "assistant",
      time: { created: 0, completed: 0 },
      parentID: "fixture-parent",
      modelID: MODEL.modelID,
      providerID: MODEL.providerID,
      mode: "build",
      path: { cwd: "/fixture/project", root: "/fixture/project" },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      finish: "stop",
    },
    parts: [{ id: `${id}-text`, sessionID: SESSION_ID, messageID: id, type: "text", text }],
  }
}

function createBtwUserMessage(text: string): PipelineMessage {
  const message = createUserMessage(
    "btw-user",
    [
      AUTO_SLASH_COMMAND_TAG_OPEN,
      "# BTW Command",
      "",
      `**User Arguments**: ${text}`,
      AUTO_SLASH_COMMAND_TAG_CLOSE,
    ].join("\n"),
  )
  const part = message.parts[0]
  if (part) {
    Object.assign(part, { [BTW_AUTO_SLASH_COMMAND_MARKER]: true })
  }

  return message
}

function createPipelineHooks() {
  return unsafeTestValue<Parameters<typeof createMessagesTransformHandler>[0]["hooks"]>(
    createTransformHooks({
      ctx: unsafeTestValue<PluginContext>({}),
      pluginConfig: OhMyOpenCodeConfigSchema.parse({}),
      isHookEnabled: (hookName) => [
        "btw-context-strip",
        "thinking-block-validator",
        "tool-pair-validator",
      ].includes(hookName),
      safeHookEnabled: false,
    }),
  )
}

describe("btw context strip transform pipeline", () => {
  describe("#given normal turns surround a completed /btw exchange", () => {
    describe("#when the real messages transform pipeline runs", () => {
      test("#then removes the /btw pair and keeps normal messages intact", async () => {
        const normalUser = createUserMessage("normal-user", "normal opening")
        const normalAssistant = createAssistantMessage("normal-assistant", "normal answer")
        const btwUser = createBtwUserMessage("PURPLE-PANDA-47")
        const btwAnswer = createAssistantMessage("btw-answer", "side answer mentions PURPLE-PANDA-47")
        const normalFollowUpUser = createUserMessage("normal-follow-up-user", "normal follow-up")
        const output: PipelineOutput = {
          messages: [normalUser, normalAssistant, btwUser, btwAnswer, normalFollowUpUser],
        }

        await createMessagesTransformHandler({ hooks: createPipelineHooks() })({}, output)

        expect(output.messages).toEqual([normalUser, normalAssistant, normalFollowUpUser])
        expect(JSON.stringify(output.messages)).not.toContain("PURPLE-PANDA-47")
      })
    })
  })
})
