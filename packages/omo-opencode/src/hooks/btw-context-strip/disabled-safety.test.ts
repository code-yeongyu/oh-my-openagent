/// <reference path="../../../bun-test.d.ts" />

import { describe, expect, test } from "bun:test"

import { loadBuiltinCommands } from "../../features/builtin-commands/commands"
import type { BuiltinCommandConfig } from "../../features/builtin-commands/types"
import {
  AUTO_SLASH_COMMAND_TAG_CLOSE,
  AUTO_SLASH_COMMAND_TAG_OPEN,
} from "../auto-slash-command/constants"
import { createBtwContextStripHook } from "./hook"
import {
  BTW_AUTO_SLASH_COMMAND_MARKER,
  isBtwMarked,
  type MessageRole,
  type MessageWithParts,
} from "./predicates"

const SECRET = "PURPLE-PANDA-47"

function buildTextMessage(role: MessageRole, text: string): MessageWithParts {
  return {
    info: { role },
    parts: [{ type: "text", text }],
  }
}

function buildBtwUserMessage(question: string): MessageWithParts {
  const message = buildTextMessage(
    "user",
    [
      AUTO_SLASH_COMMAND_TAG_OPEN,
      "# BTW Command",
      "",
      `**User Arguments**: ${question}`,
      AUTO_SLASH_COMMAND_TAG_CLOSE,
    ].join("\n"),
  )
  const part = message.parts[0]
  if (part && typeof part === "object") {
    Object.assign(part, { [BTW_AUTO_SLASH_COMMAND_MARKER]: true })
  }

  return message
}

function payload(messages: MessageWithParts[]): string {
  return JSON.stringify(messages)
}

describe("btw disabled-command safety", () => {
  describe("#given normal messages with no /btw markers", () => {
    describe("#when the strip transform runs", () => {
      test("#then output.messages is identical with the same length, content, and order", async () => {
        const messages = [
          buildTextMessage("user", "Explain the public command registry."),
          buildTextMessage("assistant", "The public registry keeps built-ins loadable."),
          buildTextMessage("user", "Continue with marker-free context."),
        ]
        const output = { messages }

        await createBtwContextStripHook(isBtwMarked)(undefined, output)

        expect(output.messages).toBe(messages)
        expect(output.messages).toHaveLength(3)
        expect(output.messages).toEqual(messages)
        expect(output.messages[0]).toBe(messages[0])
        expect(output.messages[1]).toBe(messages[1])
        expect(output.messages[2]).toBe(messages[2])
      })
    })
  })

  describe("#given disabled_commands includes btw", () => {
    describe("#when loadBuiltinCommands is called with that config", () => {
      test("#then the returned commands do not include a command named btw", () => {
        const config: BuiltinCommandConfig = { disabled_commands: ["btw"] }

        const commands = loadBuiltinCommands(config.disabled_commands)

        expect(commands.btw).toBeUndefined()
        expect(Object.keys(commands)).not.toContain("btw")
      })
    })
  })

  describe("#given messages containing a legacy /btw marker while the command is disabled", () => {
    describe("#when the strip transform runs", () => {
      test("#then no exception is thrown and the marked segment is stripped without leaking the secret", async () => {
        const config: BuiltinCommandConfig = { disabled_commands: ["btw"] }
        const commands = loadBuiltinCommands(config.disabled_commands)
        const opening = buildTextMessage("user", "Keep this public context.")
        const btwMessage = buildBtwUserMessage(`remember ${SECRET}`)
        const privateAnswer = buildTextMessage("assistant", `Private answer contains ${SECRET}.`)
        const followUp = buildTextMessage("user", "Resume public work.")
        const output = { messages: [opening, btwMessage, privateAnswer, followUp] }

        const result = await createBtwContextStripHook(isBtwMarked)(undefined, output)

        expect(result).toBeUndefined()
        expect(commands.btw).toBeUndefined()
        expect(output.messages).toEqual([opening, followUp])
        expect(payload(output.messages)).not.toContain(SECRET)
        expect(payload(output.messages)).not.toContain(AUTO_SLASH_COMMAND_TAG_OPEN)
        expect(payload(output.messages)).not.toContain("# BTW Command")
      })
    })
  })
})
