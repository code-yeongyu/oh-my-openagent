import { describe, expect, it } from "bun:test"

import { createToolPairValidatorHook } from "./hook"
import { createToolPart, runToolPairValidator, type TestMessage, type TestPart } from "./hook.test-support"

/**
 * OpenCode's `Part` union (packages/schema/src/v1/session.ts). Anything the hook adds
 * outside this set is dropped by `MessageV2.toModelMessagesEffect` before the request
 * is built, so a "repair" made of foreign part types can never reach the provider.
 */
const OPENCODE_PART_TYPES = new Set([
  "text",
  "subtask",
  "reasoning",
  "file",
  "tool",
  "step-start",
  "step-finish",
  "snapshot",
  "patch",
  "agent",
  "retry",
  "compaction",
])

const USER_PART_TYPES_SURVIVING_CONVERSION = new Set(["text", "file", "compaction", "subtask"])

type ConvertedMessage = {
  role: "user" | "assistant" | "tool"
  toolCallIDs: string[]
  toolResultIDs: string[]
}

/**
 * Conservative model of `toModelMessagesEffect` + the AI SDK `convertToModelMessages`
 * split: an assistant `tool` part always yields a `tool_use` block, but only yields the
 * paired `tool_result` once its state is terminal. Harnesses may be more forgiving; the
 * plugin must not depend on that leniency.
 */
function convertToModelMessages(messages: TestMessage[]): ConvertedMessage[] {
  const converted: ConvertedMessage[] = []

  for (const message of messages) {
    if (message.info.role === "user") {
      const surviving = message.parts.filter((part) => USER_PART_TYPES_SURVIVING_CONVERSION.has(part.type))
      if (surviving.length > 0) {
        converted.push({ role: "user", toolCallIDs: [], toolResultIDs: [] })
      }
      continue
    }

    const toolCallIDs: string[] = []
    const toolResultIDs: string[] = []
    for (const part of message.parts) {
      if (part.type !== "tool" || typeof part["callID"] !== "string") {
        continue
      }

      const state = part["state"]
      const status = state !== null && typeof state === "object" ? (state as { status?: unknown }).status : undefined
      toolCallIDs.push(part["callID"])
      if (status === "completed" || status === "error") {
        toolResultIDs.push(part["callID"])
      }
    }

    converted.push({ role: "assistant", toolCallIDs, toolResultIDs: [] })
    if (toolResultIDs.length > 0) {
      converted.push({ role: "tool", toolCallIDs: [], toolResultIDs })
    }
  }

  return converted
}

function findOrphanedToolCalls(converted: ConvertedMessage[]): string[] {
  const orphans: string[] = []

  for (let index = 0; index < converted.length; index += 1) {
    const message = converted[index]
    if (message.role !== "assistant" || message.toolCallIDs.length === 0) {
      continue
    }

    const next = converted[index + 1]
    const paired = new Set(next?.role === "tool" ? next.toolResultIDs : [])
    orphans.push(...message.toolCallIDs.filter((callID) => !paired.has(callID)))
  }

  return orphans
}

function collectForeignPartTypes(messages: TestMessage[]): string[] {
  const foreign: string[] = []
  for (const message of messages) {
    for (const part of message.parts) {
      if (!OPENCODE_PART_TYPES.has(part.type)) {
        foreign.push(part.type)
      }
    }
  }

  return foreign
}

describe("tool-pair-validator conversion invariant", () => {
  describe("#given an assistant turn with a stuck tool part", () => {
    it("#then the converted request has no orphaned tool_use", async () => {
      // given
      const messages: TestMessage[] = [
        { info: { role: "user" }, parts: [{ type: "text", text: "run it" }] },
        {
          info: { role: "assistant" },
          parts: [
            { type: "step-start" },
            { type: "text", text: "running" },
            createToolPart({ callID: "toolu_stuck", status: "running" }),
          ],
        },
        { info: { role: "user" }, parts: [{ type: "text", text: "continue" }] },
      ]
      expect(findOrphanedToolCalls(convertToModelMessages(messages))).toEqual(["toolu_stuck"])

      // when
      await runToolPairValidator(createToolPairValidatorHook(), messages)

      // then
      expect(findOrphanedToolCalls(convertToModelMessages(messages))).toEqual([])
    })
  })

  describe("#given the hook repaired a turn", () => {
    it("#then it added no part type that the conversion would discard", async () => {
      // given
      const messages: TestMessage[] = [
        {
          info: { role: "assistant" },
          parts: [createToolPart({ callID: "toolu_stuck", status: "pending" })],
        },
        { info: { role: "user" }, parts: [{ type: "text", text: "continue" }] },
      ]
      const messageCountBefore = messages.length

      // when
      await runToolPairValidator(createToolPairValidatorHook(), messages)

      // then
      expect(collectForeignPartTypes(messages)).toEqual([])
      expect(messages).toHaveLength(messageCountBefore)
    })
  })

  describe("#given a turn where every tool part is already terminal", () => {
    it("#then the conversion is clean and nothing is rewritten", async () => {
      // given
      const toolPart: TestPart = createToolPart({ callID: "toolu_done", status: "completed", output: "ok" })
      const messages: TestMessage[] = [
        { info: { role: "user" }, parts: [{ type: "text", text: "run it" }] },
        { info: { role: "assistant" }, parts: [toolPart] },
      ]
      const before = structuredClone(messages)

      // when
      await runToolPairValidator(createToolPairValidatorHook(), messages)

      // then
      expect(findOrphanedToolCalls(convertToModelMessages(messages))).toEqual([])
      expect(messages).toEqual(before)
    })
  })
})
