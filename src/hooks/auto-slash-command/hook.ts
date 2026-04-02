import {
  detectSlashCommand,
  extractPromptText,
  findSlashCommandPartIndex,
} from "./detector"
import { executeSlashCommand, type ExecutorOptions } from "./executor"
import { log } from "../../shared"
import {
  AUTO_SLASH_COMMAND_TAG_CLOSE,
  AUTO_SLASH_COMMAND_TAG_OPEN,
} from "./constants"
import { createProcessedCommandStore } from "./processed-command-store"
import type {
  AutoSlashCommandHookInput,
  AutoSlashCommandHookOutput,
  CommandExecuteBeforeInput,
  CommandExecuteBeforeOutput,
} from "./types"
import type { LoadedSkill } from "../../features/opencode-skill-loader"

const COMMAND_EXECUTE_FALLBACK_DEDUP_TTL_MS = 100

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getDeletedSessionID(properties: unknown): string | null {
  if (!isRecord(properties)) {
    return null
  }

  const info = properties.info
  if (!isRecord(info)) {
    return null
  }

  return typeof info.id === "string" ? info.id : null
}

function getCommandExecutionEventID(input: CommandExecuteBeforeInput): string | null {
  const candidateKeys = [
    "messageID",
    "messageId",
    "eventID",
    "eventId",
    "invocationID",
    "invocationId",
    "commandID",
    "commandId",
  ]

  const recordInput = input as unknown
  if (!isRecord(recordInput)) {
    return null
  }

  for (const key of candidateKeys) {
    const candidateValue = recordInput[key]
    if (typeof candidateValue === "string" && candidateValue.length > 0) {
      return candidateValue
    }
  }

  return null
}

export interface AutoSlashCommandHookOptions {
  skills?: LoadedSkill[]
  pluginsEnabled?: boolean
  enabledPluginsOverride?: Record<string, boolean>
  directory?: string
}

export function createAutoSlashCommandHook(options?: AutoSlashCommandHookOptions) {
  const executorOptions: ExecutorOptions = {
    skills: options?.skills,
    pluginsEnabled: options?.pluginsEnabled,
    enabledPluginsOverride: options?.enabledPluginsOverride,
    directory: options?.directory,
  }
  const sessionProcessedCommands = createProcessedCommandStore()
  const sessionProcessedCommandExecutions = createProcessedCommandStore()

  const dispose = (): void => {
    sessionProcessedCommands.clear()
    sessionProcessedCommandExecutions.clear()
  }

  return {
    "chat.message": async (
      input: AutoSlashCommandHookInput,
      output: AutoSlashCommandHookOutput
    ): Promise<void> => {
      const promptText = extractPromptText(output.parts)

      // Debug logging to diagnose slash command issues
      if (promptText.startsWith("/")) {
        log(`[auto-slash-command] chat.message hook received slash command`, {
          sessionID: input.sessionID,
          promptText: promptText.slice(0, 100),
        })
      }

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

      const commandKey = input.messageID
        ? `${input.sessionID}:${input.messageID}:${parsed.command}`
        : `${input.sessionID}:${parsed.command}`
      if (sessionProcessedCommands.has(commandKey)) {
        return
      }
      sessionProcessedCommands.add(commandKey)

      log(`[auto-slash-command] Detected: /${parsed.command}`, {
        sessionID: input.sessionID,
        args: parsed.args,
      })

      const executionOptions: ExecutorOptions = {
        ...executorOptions,
        agent: input.agent,
      }

      const result = await executeSlashCommand(parsed, executionOptions)

      const idx = findSlashCommandPartIndex(output.parts)
      if (idx < 0) {
        return
      }

      if (!result.success || !result.replacementText) {
        log(`[auto-slash-command] Command not found, skipping`, {
          sessionID: input.sessionID,
          command: parsed.command,
          error: result.error,
        })
        return
      }

      const taggedContent = `${AUTO_SLASH_COMMAND_TAG_OPEN}\n${result.replacementText}\n${AUTO_SLASH_COMMAND_TAG_CLOSE}`
      output.parts[idx].text = taggedContent

      log(`[auto-slash-command] Replaced message with command template`, {
        sessionID: input.sessionID,
        command: parsed.command,
      })
    },

    "command.execute.before": async (
      input: CommandExecuteBeforeInput,
      output: CommandExecuteBeforeOutput
    ): Promise<void> => {
      const eventID = getCommandExecutionEventID(input)
      const commandKey = eventID
        ? `${input.sessionID}:event:${eventID}`
        : `${input.sessionID}:fallback:${input.command.toLowerCase()}:${input.arguments || ""}`
      if (sessionProcessedCommandExecutions.has(commandKey)) {
        return
      }

      log(`[auto-slash-command] command.execute.before received`, {
        sessionID: input.sessionID,
        command: input.command,
        arguments: input.arguments,
      })

      const parsed = {
        command: input.command,
        args: input.arguments || "",
        raw: `/${input.command}${input.arguments ? " " + input.arguments : ""}`,
      }

      const executionOptions: ExecutorOptions = {
        ...executorOptions,
        agent: input.agent,
      }

      const result = await executeSlashCommand(parsed, executionOptions)

      if (!result.success || !result.replacementText) {
        log(`[auto-slash-command] command.execute.before - command not found in our executor`, {
          sessionID: input.sessionID,
          command: input.command,
          error: result.error,
        })
        return
      }

      sessionProcessedCommandExecutions.add(
        commandKey,
        eventID ? undefined : COMMAND_EXECUTE_FALLBACK_DEDUP_TTL_MS
      )

      const taggedContent = `${AUTO_SLASH_COMMAND_TAG_OPEN}\n${result.replacementText}\n${AUTO_SLASH_COMMAND_TAG_CLOSE}`

      const idx = findSlashCommandPartIndex(output.parts)
      if (idx >= 0) {
        output.parts[idx].text = taggedContent
      } else {
        output.parts.unshift({ type: "text", text: taggedContent })
      }

      log(`[auto-slash-command] command.execute.before - injected template`, {
        sessionID: input.sessionID,
        command: input.command,
      })
    },
    event: async ({
      event,
    }: {
      event: { type: string; properties?: unknown }
    }): Promise<void> => {
      if (event.type !== "session.deleted") {
        return
      }

      const sessionID = getDeletedSessionID(event.properties)
      if (!sessionID) {
        return
      }

      sessionProcessedCommands.cleanupSession(sessionID)
      sessionProcessedCommandExecutions.cleanupSession(sessionID)
    },
    dispose,
  }
}
