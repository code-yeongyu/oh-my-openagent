import { log } from "../../shared"
import { extractPromptText } from "./prompt-text"
import type {
  ChatMessageHooks,
  ChatMessageInput,
  ChatMessageHandlerOutput,
  UlwExecuteHookOutput,
  WorkStartingCommand,
} from "./types"

const ULW_EXECUTE_TEMPLATE_MARKER = "You are starting an Atlas work session."

export function isUlwExecuteHookOutput(value: unknown): value is UlwExecuteHookOutput {
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

export function isUlwExecuteFallbackTemplate(promptText: string): boolean {
  return (
    promptText.includes("<session-context>") &&
    promptText.includes(ULW_EXECUTE_TEMPLATE_MARKER)
  )
}

export function clearStoppedContinuationBeforeUlwExecute(
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

export async function runUlwExecuteHookIfApplicable(
  hooks: ChatMessageHooks,
  input: ChatMessageInput,
  output: ChatMessageHandlerOutput,
): Promise<void> {
  if (!hooks.ulwExecute || !isUlwExecuteHookOutput(output)) {
    return
  }

  const promptText = extractPromptText(output.parts)
  if (isUlwExecuteFallbackTemplate(promptText)) {
    clearStoppedContinuationBeforeUlwExecute(hooks, input.sessionID, "ulw-execute")
  }
  await hooks.ulwExecute["chat.message"]?.(input, output)
}
