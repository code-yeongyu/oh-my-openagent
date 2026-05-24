import { log } from "../logger"
import {
  isSyntheticOrInternalUserMessage,
  type InternalInitiatorMessageLike,
  type InternalInitiatorTextPartLike,
} from "../internal-initiator-marker"
import { isRecord } from "../record-type-guard"
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

function messageRole(message: unknown): string | undefined {
  if (!isRecord(message)) {
    return undefined
  }
  const info = message.info
  if (isRecord(info) && typeof info.role === "string") {
    return info.role
  }
  return typeof message.role === "string" ? message.role : undefined
}

function messageFinish(message: unknown): string | true | undefined {
  if (!isRecord(message)) {
    return undefined
  }
  const info = message.info
  if (isRecord(info)) {
    if (info.finish === true) {
      return true
    }
    if (typeof info.finish === "string" && info.finish.length > 0) {
      return info.finish
    }
  }
  if (message.finish === true) {
    return true
  }
  return typeof message.finish === "string" && message.finish.length > 0 ? message.finish : undefined
}

function messageCompleted(message: unknown): boolean {
  if (!isRecord(message)) {
    return false
  }
  const info = message.info
  const time = isRecord(info) && isRecord(info.time) ? info.time : undefined
  const completed = time?.completed
  if (typeof completed === "number" && Number.isFinite(completed)) {
    return true
  }
  return typeof completed === "string" && completed.length > 0
}

function toInternalInitiatorTextPartLike(part: unknown): InternalInitiatorTextPartLike {
  const result: InternalInitiatorTextPartLike = {}
  if (!isRecord(part)) {
    return result
  }

  if (typeof part.type === "string") {
    result.type = part.type
  }
  if (typeof part.text === "string") {
    result.text = part.text
  }
  if (typeof part.synthetic === "boolean") {
    result.synthetic = part.synthetic
  }
  return result
}

function toInternalInitiatorMessageLike(message: unknown): InternalInitiatorMessageLike | undefined {
  if (!isRecord(message)) {
    return undefined
  }

  const result: InternalInitiatorMessageLike = {}
  const info = message.info
  if (isRecord(info) && typeof info.role === "string") {
    result.info = { role: info.role }
  }
  if (typeof message.role === "string") {
    result.role = message.role
  }
  if (Array.isArray(message.parts)) {
    result.parts = message.parts.map(toInternalInitiatorTextPartLike)
  }
  return result
}

function messageIsSyntheticOrInternalUser(message: unknown): boolean {
  const initiatorMessage = toInternalInitiatorMessageLike(message)
  return initiatorMessage !== undefined && isSyntheticOrInternalUserMessage(initiatorMessage)
}

function partIsWaitingOnTool(part: unknown): boolean {
  if (!isRecord(part)) {
    return false
  }
  if (
    part.type !== "tool"
    && part.type !== "tool_use"
    && part.type !== "tool-call"
    && part.type !== "tool-invocation"
  ) {
    return false
  }

  const state = part.state
  if (!isRecord(state)) {
    return false
  }
  return state.status === "pending" || state.status === "running"
}

export function latestAssistantTurnBlocksInternalPrompt(messages: unknown[]): boolean {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    const role = messageRole(message)
    if (role === "assistant") {
      if (messageCompleted(message)) {
        return false
      }
      const finish = messageFinish(message)
      if (finish === true) {
        return false
      }
      if (finish === undefined || finish === "unknown") {
        return true
      }
      if (!isRecord(message) || !Array.isArray(message.parts)) {
        return finish === "tool-calls"
      }
      return finish === "tool-calls" || message.parts.some(partIsWaitingOnTool)
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
    return false
  }
}
