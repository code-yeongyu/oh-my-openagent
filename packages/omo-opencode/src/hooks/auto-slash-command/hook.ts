import { isRecord } from "@oh-my-opencode/utils"
import {
  detectSlashCommand,
  extractPromptText,
  findSlashCommandPartIndex,
} from "./detector"
import { executeSlashCommand, type ExecutorOptions } from "./executor"
import { log } from "../../shared"
import { resolveSessionEventID } from "../../shared/event-session-id"
import {
  AUTO_SLASH_COMMAND_TAG_CLOSE,
  AUTO_SLASH_COMMAND_TAG_OPEN,
} from "./constants"
import { createProcessedCommandStore } from "./processed-command-store"
import { BTW_AUTO_SLASH_COMMAND_MARKER } from "../btw-context-strip/predicates"
import { clearBtwTurnActive, markBtwTurnActive } from "../btw-tool-guard/turn-state"
import {
  getMainSessionID,
  subagentSessions,
  syncSubagentSessions,
} from "../../features/claude-code-session-state"
import { lookupTeamSession } from "../../features/team-mode/team-session-registry"
import type {
  AutoSlashCommandHookInput,
  AutoSlashCommandHookOutput,
  CommandExecuteBeforeInput,
  CommandExecuteBeforeOutput,
} from "./types"
import type { LoadedSkill } from "../../features/opencode-skill-loader"

const COMMAND_EXECUTE_FALLBACK_DEDUP_TTL_MS = 100



function getDeletedSessionID(properties: unknown): string | null {
  return resolveSessionEventID(properties) ?? null
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

  const recordInput: unknown = input
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

function markBtwCommandMessage(
  command: string,
  output: { message?: Record<string, unknown> },
): void {
  if (command.toLowerCase() !== "btw") {
    return
  }

  output.message ??= {}
  output.message[BTW_AUTO_SLASH_COMMAND_MARKER] = true
}

function markBtwCommandPart(command: string, part: Record<string, unknown>): void {
  if (command.toLowerCase() !== "btw") {
    return
  }

  part[BTW_AUTO_SLASH_COMMAND_MARKER] = true
}

function partsContainAutoSlashCommandTags(parts: Array<{ text?: string }>): boolean {
  return parts.some((part) =>
    typeof part.text === "string"
    && (
      part.text.includes(AUTO_SLASH_COMMAND_TAG_OPEN)
      || part.text.includes(AUTO_SLASH_COMMAND_TAG_CLOSE)
    )
  )
}

function isBtwChatTraffic(promptText: string, parts: Array<Record<string, unknown>>): boolean {
  if (parts.some((part) => part[BTW_AUTO_SLASH_COMMAND_MARKER] === true)) {
    return true
  }

  return detectSlashCommand(promptText)?.command.toLowerCase() === "btw"
}

// /btw is documented as primary-session-only; expanding it in subagent, team,
// or non-main sessions would inject the template where the tool guard does not
// protect it, so those sessions keep the raw text instead.
function isBtwExpansionAllowed(command: string, sessionID: string): boolean {
  if (command.toLowerCase() !== "btw") {
    return true
  }

  if (subagentSessions.has(sessionID) || syncSubagentSessions.has(sessionID)) {
    return false
  }

  if (lookupTeamSession(sessionID)) {
    return false
  }

  const mainSessionID = getMainSessionID()
  return !mainSessionID || mainSessionID === sessionID
}

export interface AutoSlashCommandHookOptions {
  skills?: LoadedSkill[]
  pluginsEnabled?: boolean
  enabledPluginsOverride?: Record<string, boolean>
  directory?: string
  disabledCommands?: string[]
}

export function createAutoSlashCommandHook(options?: AutoSlashCommandHookOptions) {
  const executorOptions: ExecutorOptions = {
    skills: options?.skills,
    pluginsEnabled: options?.pluginsEnabled,
    enabledPluginsOverride: options?.enabledPluginsOverride,
    directory: options?.directory,
    disabledCommands: options?.disabledCommands,
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

      // Non-/btw traffic ends any active /btw turn; /btw traffic (fresh or a
      // tagged refire of the same marked message) must keep the guard state.
      if (!isBtwChatTraffic(promptText, output.parts)) {
        clearBtwTurnActive(input.sessionID)
      }

      // Debug logging to diagnose slash command issues
      if (promptText.startsWith("/")) {
        const isBtwCommand = promptText.toLowerCase().startsWith("/btw")
        log(`[auto-slash-command] chat.message hook received slash command`, {
          sessionID: input.sessionID,
          promptText: isBtwCommand ? "[redacted /btw side-question]" : promptText.slice(0, 100),
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

      if (!isBtwExpansionAllowed(parsed.command, input.sessionID)) {
        log(`[auto-slash-command] Skipping /btw expansion outside the primary session`, {
          sessionID: input.sessionID,
        })
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
        args: parsed.command.toLowerCase() === "btw" ? "[redacted /btw side-question]" : parsed.args,
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
      markBtwCommandPart(parsed.command, output.parts[idx])
      markBtwCommandMessage(parsed.command, output)
      if (parsed.command.toLowerCase() === "btw") {
        markBtwTurnActive(input.sessionID)
      }

      log(`[auto-slash-command] Replaced message with command template`, {
        sessionID: input.sessionID,
        command: parsed.command,
      })
    },

    "command.execute.before": async (
      input: CommandExecuteBeforeInput,
      output: CommandExecuteBeforeOutput
    ): Promise<void> => {
      if (input.command.toLowerCase() !== "btw") {
        clearBtwTurnActive(input.sessionID)
      }

      if (!isBtwExpansionAllowed(input.command, input.sessionID)) {
        log(`[auto-slash-command] Skipping /btw expansion outside the primary session`, {
          sessionID: input.sessionID,
        })
        return
      }

      if (partsContainAutoSlashCommandTags(output.parts)) {
        return
      }

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
        arguments: input.command.toLowerCase() === "btw" ? "[redacted /btw side-question]" : input.arguments,
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
        markBtwCommandPart(parsed.command, output.parts[idx])
      } else {
        const injectedPart = { type: "text", text: taggedContent }
        markBtwCommandPart(parsed.command, injectedPart)
        output.parts.unshift(injectedPart)
      }
      markBtwCommandMessage(parsed.command, output)
      if (parsed.command.toLowerCase() === "btw") {
        markBtwTurnActive(input.sessionID)
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
      clearBtwTurnActive(sessionID)
    },
    dispose,
  }
}
