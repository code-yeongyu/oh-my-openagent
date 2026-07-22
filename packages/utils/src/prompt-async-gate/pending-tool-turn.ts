import { log } from "../logger"
import {
  messageCompleted,
  messageFinish,
  messageHasQuestionTool,
  messageHasSubstantiveAssistantOutput,
  messageHasTerminalError,
  messageHasUnresolvedTool,
  messageHasWaitingTool,
  messageHasInternalInitiatorMarker,
  messageIsSyntheticOrInternalUser,
  messageIsTerminalNoReplyUser,
  messageRole,
} from "./prompt-message-state"
import { isRecord } from "../record-type-guard"
import { isPromptMessageInspectionAborted } from "./message-inspection-error"
import { withDispatchTimeout } from "./timing"
import type { PromptDispatchClient, PromptMessagesQuery, PromptSessionName } from "./types"

function getPromptQuery(input: unknown): PromptMessagesQuery {
  if (!isRecord(input)) {
    return { directory: "" }
  }
  const query = input.query
  if (!isRecord(query)) {
    return { directory: "" }
  }

  const promptQuery: PromptMessagesQuery = { directory: "" }
  if (typeof query.directory === "string") {
    return typeof query.limit === "number"
      ? { directory: query.directory, limit: query.limit }
      : { directory: query.directory }
  }
  if (typeof query.limit === "number") {
    return { ...promptQuery, limit: query.limit }
  }
  return promptQuery
}

function getMessagesData(response: unknown): unknown[] {
  if (isRecord(response) && Array.isArray(response.data)) {
    return response.data
  }
  return Array.isArray(response) ? response : []
}

export function latestAssistantTurnHasUnansweredQuestion(messages: unknown[]): boolean {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    const role = messageRole(message)
    if (role === "assistant") {
      return messageHasQuestionTool(message)
    }
    if (role === "user") {
      if (messageIsSyntheticOrInternalUser(message)) {
        continue
      }
      return false
    }
  }
  return false
}

export function latestAssistantTurnBlocksInternalPrompt(messages: unknown[]): boolean {
  let sawAssistantAfterLatestUser = false
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    const role = messageRole(message)
    if (role === "assistant") {
      sawAssistantAfterLatestUser = true
      if (messageHasQuestionTool(message)) {
        return true
      }
      const finish = messageFinish(message)
      if (finish === "tool-calls") {
        return !isRecord(message) || !Array.isArray(message.parts) || messageHasUnresolvedTool(message)
      }
      if (messageHasTerminalError(message)) {
        return false
      }
      if (
        (finish === undefined || finish === "unknown")
        && !messageHasSubstantiveAssistantOutput(message)
      ) {
        return true
      }
      if (messageCompleted(message)) {
        return false
      }
      if (finish === true) {
        return false
      }
      if (finish === undefined || finish === "unknown") {
        return true
      }
      if (!isRecord(message) || !Array.isArray(message.parts)) {
        return finish === "tool-calls"
      }
      return messageHasWaitingTool(message)
    }
    if (role === "user") {
      if (messageIsSyntheticOrInternalUser(message)) {
        if (messageIsTerminalNoReplyUser(message)) {
          continue
        }
        if (!sawAssistantAfterLatestUser) {
          if (messageHasInternalInitiatorMarker(message)) {
            continue
          }
          return true
        }
        continue
      }
      return false
    }
  }
  return false
}

export async function sessionLatestAssistantBlocksInternalPrompt<TInput>(args: {
  readonly client: PromptDispatchClient
  readonly sessionID: string
  readonly input: TInput
  readonly sessionName: PromptSessionName
  readonly source: string
  readonly timeoutMs: number
}): Promise<boolean> {
  const session = args.client.session
  if (typeof session?.messages !== "function") {
    return false
  }
  const messages = session.messages.bind(session)

  try {
    const response = await withDispatchTimeout(
      messages({
        path: { id: args.sessionID },
        query: getPromptQuery(args.input),
      }),
      args.timeoutMs,
      `[prompt-async-gate] ${args.sessionName} session.messages`,
    )
    return latestAssistantTurnBlocksInternalPrompt(getMessagesData(response))
  } catch (error) {
    log("[prompt-async-gate] latest assistant prompt-block check failed", {
      sessionID: args.sessionID,
      source: args.source,
      error: String(error),
    })
    return !isPromptMessageInspectionAborted(error)
  }
}
