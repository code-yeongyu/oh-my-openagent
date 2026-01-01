import {
  detectSlashCommand,
  extractPromptText,
} from "./detector"
import { executeSlashCommand } from "./executor"
import { log } from "../../shared"
import {
  AUTO_SLASH_COMMAND_TAG_OPEN,
  AUTO_SLASH_COMMAND_TAG_CLOSE,
} from "./constants"
import type {
  AutoSlashCommandHookInput,
  AutoSlashCommandHookOutput,
} from "./types"

export * from "./detector"
export * from "./executor"
export * from "./constants"
export * from "./types"

const sessionProcessedCommands = new Set<string>()

export function createAutoSlashCommandHook() {
  return {
    "chat.message": async (
      input: AutoSlashCommandHookInput,
      output: AutoSlashCommandHookOutput
    ): Promise<void> => {
      const promptText = extractPromptText(output.parts)

      if (
        promptText.includes(AUTO_SLASH_COMMAND_TAG_OPEN) ||
        promptText.includes(AUTO_SLASH_COMMAND_TAG_CLOSE)
      ) {
        return
      }

      const parsed = detectSlashCommand(promptText)

      if (!parsed) {
        return
      }

      const commandKey = `${input.sessionID}:${input.messageID}:${parsed.command}`
      if (sessionProcessedCommands.has(commandKey)) {
        return
      }
      sessionProcessedCommands.add(commandKey)

      log(`[auto-slash-command] Detected: /${parsed.command}`, {
        sessionID: input.sessionID,
        args: parsed.args,
      })

      const result = await executeSlashCommand(parsed)

      const idx = output.parts.findIndex((p) => p.type === "text" && p.text)
      if (idx < 0) {
        return
      }

      if (result.success && result.replacementText) {
        const taggedContent = `${AUTO_SLASH_COMMAND_TAG_OPEN}\n${result.replacementText}\n${AUTO_SLASH_COMMAND_TAG_CLOSE}`
        output.parts[idx].text = taggedContent

        log(`[auto-slash-command] Replaced message with command template`, {
          sessionID: input.sessionID,
          command: parsed.command,
        })
      } else {
        const errorMessage = `${AUTO_SLASH_COMMAND_TAG_OPEN}\n[AUTO-SLASH-COMMAND ERROR]\n${result.error}\n\nOriginal input: ${parsed.raw}\n${AUTO_SLASH_COMMAND_TAG_CLOSE}`
        output.parts[idx].text = errorMessage

        log(`[auto-slash-command] Command not found, showing error`, {
          sessionID: input.sessionID,
          command: parsed.command,
          error: result.error,
        })
      }
    },
  }
}
