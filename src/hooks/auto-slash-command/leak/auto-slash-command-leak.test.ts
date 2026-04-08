import { afterAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { AUTO_SLASH_COMMAND_TAG_OPEN } from "../constants"
import type {
  AutoSlashCommandHookInput,
  AutoSlashCommandHookOutput,
  CommandExecuteBeforeInput,
  CommandExecuteBeforeOutput,
} from "../types"
import * as shared from "../../../shared"

const executeSlashCommandMock = mock(
  async (parsed: { command: string; args: string; raw: string }) => ({
    success: true,
    replacementText: parsed.raw,
  })
)

mock.module("../executor", () => ({
  executeSlashCommand: executeSlashCommandMock,
}))

afterAll(async () => {
  mock.restore()
  // Restore the real executor module so subsequent test files in the same batch
  // (e.g. executor-resolution.test.ts) don't get the mocked version
  const realExecutor = await import("../executor")
  mock.module("../executor", () => realExecutor)
})

const logMock = spyOn(shared, "log").mockImplementation(() => {})

const { createAutoSlashCommandHook } = await import("../hook")

function createChatInput(sessionID: string, messageID: string): AutoSlashCommandHookInput {
  return {
    sessionID,
    messageID,
  }
}

function createChatOutput(text: string): AutoSlashCommandHookOutput {
  return {
    message: {},
    parts: [{ type: "text", text }],
  }
}

function createCommandInput(sessionID: string, command: string): CommandExecuteBeforeInput {
  return {
    sessionID,
    command,
    arguments: "",
  }
}

function createCommandOutput(text: string): CommandExecuteBeforeOutput {
  return {
    parts: [{ type: "text", text }],
  }
}

describe("createAutoSlashCommandHook leak prevention", () => {
  beforeEach(() => {
    executeSlashCommandMock.mockClear()
    logMock.mockClear()
  })

  describe("#given hook with sessionProcessedCommandExecutions", () => {
    describe("#when same command executed twice after fallback dedup window", () => {
      it("#then second execution is treated as intentional rerun", async () => {
        //#given
        const nowSpy = spyOn(Date, "now")
        try {
          const hook = createAutoSlashCommandHook()
          const input = createCommandInput("session-dedup", "leak-test-command")
          const firstOutput = createCommandOutput("first")
          const secondOutput = createCommandOutput("second")

          //#when
          nowSpy.mockReturnValue(0)
          await hook["command.execute.before"](input, firstOutput)
          nowSpy.mockReturnValue(101)
          await hook["command.execute.before"](input, secondOutput)

          //#then
          expect(executeSlashCommandMock).toHaveBeenCalledTimes(2)
          expect(firstOutput.parts[0].text).toContain(AUTO_SLASH_COMMAND_TAG_OPEN)
          expect(secondOutput.parts[0].text).toContain(AUTO_SLASH_COMMAND_TAG_OPEN)
        } finally {
          nowSpy.mockRestore()
        }
      })
    })

    describe("#when same command is repeated within fallback dedup window", () => {
      it("#then duplicate dispatch is suppressed", async () => {
        //#given
        const nowSpy = spyOn(Date, "now")
        try {
          const hook = createAutoSlashCommandHook()
          const input = createCommandInput("session-dedup", "leak-test-command")
          const firstOutput = createCommandOutput("first")
          const secondOutput = createCommandOutput("second")

          //#when
          nowSpy.mockReturnValue(0)
          await hook["command.execute.before"](input, firstOutput)
          nowSpy.mockReturnValue(99)
          await hook["command.execute.before"](input, secondOutput)

          //#then
          expect(executeSlashCommandMock).toHaveBeenCalledTimes(1)
          expect(firstOutput.parts[0].text).toContain(AUTO_SLASH_COMMAND_TAG_OPEN)
          expect(secondOutput.parts[0].text).toBe("second")
        } finally {
          nowSpy.mockRestore()
        }
      })
    })

    describe("#when same event identifier is dispatched twice", () => {
      it("#then second dispatch is deduplicated regardless of elapsed seconds", async () => {
        //#given
        const nowSpy = spyOn(Date, "now")
        try {
          const hook = createAutoSlashCommandHook()
          const input: CommandExecuteBeforeInput = {
            ...createCommandInput("session-dedup", "leak-test-command"),
            eventID: "event-1",
          }
          const firstOutput = createCommandOutput("first")
          const secondOutput = createCommandOutput("second")

          //#when
          nowSpy.mockReturnValue(0)
          await hook["command.execute.before"](input, firstOutput)
          nowSpy.mockReturnValue(29_999)
          await hook["command.execute.before"](input, secondOutput)

          //#then
          expect(executeSlashCommandMock).toHaveBeenCalledTimes(1)
          expect(firstOutput.parts[0].text).toContain(AUTO_SLASH_COMMAND_TAG_OPEN)
          expect(secondOutput.parts[0].text).toBe("second")
        } finally {
          nowSpy.mockRestore()
        }
      })
    })
  })

  describe("#given hook with entries from multiple sessions", () => {
    describe("#when dispose() is called", () => {
      it("#then both Sets are empty", async () => {
        const hook = createAutoSlashCommandHook()
        await hook["chat.message"](
          createChatInput("session-chat", "message-chat"),
          createChatOutput("/leak-chat")
        )
        await hook["command.execute.before"](
          createCommandInput("session-command", "leak-command"),
          createCommandOutput("before")
        )
        executeSlashCommandMock.mockClear()

        hook.dispose()
        const chatOutputAfterDispose = createChatOutput("/leak-chat")
        const commandOutputAfterDispose = createCommandOutput("after")
        await hook["chat.message"](
          createChatInput("session-chat", "message-chat"),
          chatOutputAfterDispose
        )
        await hook["command.execute.before"](
          createCommandInput("session-command", "leak-command"),
          commandOutputAfterDispose
        )

        expect(executeSlashCommandMock).toHaveBeenCalledTimes(2)
        expect(chatOutputAfterDispose.parts[0].text).toContain(AUTO_SLASH_COMMAND_TAG_OPEN)
        expect(commandOutputAfterDispose.parts[0].text).toContain(
          AUTO_SLASH_COMMAND_TAG_OPEN
        )
      })
    })
  })

  describe("#given Set with more than 10000 entries", () => {
    describe("#when new entry added", () => {
      it("#then Set size is reduced", async () => {
        const hook = createAutoSlashCommandHook()
        const oldestInput = createChatInput("session-oldest", "message-oldest")
        await hook["chat.message"](oldestInput, createChatOutput("/leak-oldest"))

        for (let index = 0; index < 10000; index += 1) {
          await hook["chat.message"](
            createChatInput(`session-${index}`, `message-${index}`),
            createChatOutput(`/leak-${index}`)
          )
        }

        const newestInput = createChatInput("session-newest", "message-newest")
        await hook["chat.message"](newestInput, createChatOutput("/leak-newest"))
        executeSlashCommandMock.mockClear()
        const oldestRetryOutput = createChatOutput("/leak-oldest")
        const newestRetryOutput = createChatOutput("/leak-newest")

        await hook["chat.message"](oldestInput, oldestRetryOutput)
        await hook["chat.message"](newestInput, newestRetryOutput)

        expect(executeSlashCommandMock).toHaveBeenCalledTimes(1)
        expect(oldestRetryOutput.parts[0].text).toContain(AUTO_SLASH_COMMAND_TAG_OPEN)
        expect(newestRetryOutput.parts[0].text).toBe("/leak-newest")
      })
    })
  })
})
