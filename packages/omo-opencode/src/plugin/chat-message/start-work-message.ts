import { log } from "../../shared"
import { extractPromptText } from "./prompt-text"
import type {
  ChatMessageHooks,
  ChatMessageInput,
  ChatMessageHandlerOutput,
  StartWorkHookOutput,
  WorkStartingCommand,
} from "./types"

const START_WORK_TEMPLATE_MARKER = "You are starting a Sisyphus work session."

export function isStartWorkHookOutput(value: unknown): value is StartWorkHookOutput {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  const partsValue = record.parts
  if (!Array.isArray(partsValue)) return false
  return partsValue.every((part) => {
    if (typeof part !== "object" || part === null) return false
    const partRecord = part as Record<string, unknown>
    return typeof partRecord.type === "string"
  })
}

export function isStartWorkFallbackTemplate(promptText: string): boolean {
  return (
    promptText.includes("<session-context>") &&
    promptText.includes(START_WORK_TEMPLATE_MARKER)
  )
}

export function clearStoppedContinuationBeforeWorkStart(
  hooks: ChatMessageHooks,
  sessionID: string,
  command: WorkStartingCommand,
): void {
  if (hooks.stopContinuationGuard?.isStopped(sessionID)) {
    hooks.stopContinuationGuard.clear(sessionID)
    log("[stop-continuation] Stop state cleared by chat.message work-starting command", {
      sessionID,
      command,
    })
  }
}

export async function runStartWorkHookIfApplicable(
  hooks: ChatMessageHooks,
  input: ChatMessageInput,
  output: ChatMessageHandlerOutput,
): Promise<void> {
  if (!hooks.startWork || !isStartWorkHookOutput(output)) {
    return
  }

  const promptText = extractPromptText(output.parts)
  if (isStartWorkFallbackTemplate(promptText)) {
    clearStoppedContinuationBeforeWorkStart(hooks, input.sessionID, "start-work")
  }
  await hooks.startWork["chat.message"]?.(input, output)
}
