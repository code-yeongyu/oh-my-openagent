import type { V2ModelRef, V2SessionMessage, V2StructuredError, V2TokenUsage } from "../context-types"
import { translateToolPart } from "./translate-tool-part"
import type { V1Message, V1MessageInfo, V1Part } from "./v1-message-types"

export type TranslateInput = {
  readonly messages: ReadonlyArray<V2SessionMessage>
  readonly sessionID: string
  readonly directory: string
  readonly worktree: string
  /** Agent and model in effect before the first switch entry; the host reports no such history. */
  readonly initial: { readonly agent: string; readonly model?: V2ModelRef }
}

const NO_TOKENS: V2TokenUsage = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

function toV1Error(error: V2StructuredError): NonNullable<V1MessageInfo["error"]> {
  return { name: error.type, data: { message: error.message, ...(error.status === undefined ? {} : { statusCode: error.status }) } }
}

/**
 * The 2.x session log as 1.x `{ info, parts }` messages. 2.x keeps injected context as separate
 * log entries where 1.x folded it into the user message's parts, so each becomes a user message
 * whose text part is marked synthetic. Entries with no 1.x counterpart (idle, shell, location
 * switches) are dropped, and agent/model switches only set the values later messages carry.
 */
export function translateMessages(input: TranslateInput): V1Message[] {
  const { sessionID } = input
  const path = { cwd: input.directory, root: input.worktree }
  let agent = input.initial.agent
  let model: V2ModelRef | undefined = input.initial.model
  let parentID: string | undefined
  const result: V1Message[] = []

  const part = (messageID: string, index: number | string, fields: Record<string, unknown> & { type: string }): V1Part => ({
    id: `${messageID}:${index}`,
    sessionID,
    messageID,
    ...fields,
  })
  const userInfo = (id: string, created: number): V1MessageInfo => ({
    id,
    sessionID,
    role: "user",
    time: { created },
    agent,
    ...(model === undefined ? {} : { model: { providerID: model.providerID, modelID: model.id } }),
    ...(model?.variant === undefined ? {} : { variant: model.variant }),
  })
  const pushUser = (id: string, created: number, parts: V1Part[]) => {
    parentID = id
    result.push({ info: userInfo(id, created), parts })
  }

  for (const message of input.messages) {
    if (message.type === "agent-switched") agent = message.agent
    else if (message.type === "model-switched") model = message.model
    else if (message.type === "user") {
      const files = (message.files ?? []).map((file, index) =>
        part(message.id, index + 1, { type: "file", url: file.uri, ...(file.name === undefined ? {} : { filename: file.name }) }),
      )
      pushUser(message.id, message.time.created, [part(message.id, 0, { type: "text", text: message.text }), ...files])
    } else if (message.type === "synthetic" || message.type === "system" || message.type === "skill") {
      pushUser(message.id, message.time.created, [part(message.id, 0, { type: "text", text: message.text, synthetic: true })])
    } else if (message.type === "idle") {
      // 1.x recorded a failed or aborted turn as an assistant message carrying the error; 2.x only
      // logs it on the idle entry, so pollers that look for `info.error` would never see it.
      const previous = result[result.length - 1]?.info
      const reported = previous?.role === "assistant" && previous.error !== undefined
      const error =
        message.outcome === "failed"
          ? message.error === undefined
            ? { name: "UnknownError", data: { message: "Execution failed" } }
            : toV1Error(message.error)
          : message.outcome === "interrupted"
            ? { name: "MessageAbortedError", data: { message: "Aborted" } }
            : undefined
      if (error !== undefined && !reported) {
        result.push({
          info: {
            id: message.id,
            sessionID,
            role: "assistant",
            ...(parentID === undefined ? {} : { parentID }),
            agent,
            mode: agent,
            ...(model === undefined ? {} : { providerID: model.providerID, modelID: model.id }),
            cost: 0,
            tokens: NO_TOKENS,
            path,
            error,
            time: { created: message.time.created, completed: message.time.created },
          },
          parts: [],
        })
      }
    } else if (message.type === "compaction") {
      pushUser(message.id, message.time.created, [part(message.id, 0, { type: "compaction", auto: message.reason === "auto" })])
      if (message.status === "completed" && message.summary !== undefined) {
        const summaryID = `${message.id}:summary`
        result.push({
          info: {
            id: summaryID,
            sessionID,
            role: "assistant",
            parentID: message.id,
            agent,
            mode: agent,
            ...(model === undefined ? {} : { providerID: model.providerID, modelID: model.id }),
            finish: "stop",
            cost: 0,
            tokens: NO_TOKENS,
            summary: true,
            path,
            time: { created: message.time.created, completed: message.time.created },
          },
          parts: [part(summaryID, 0, { type: "text", text: message.summary })],
        })
      }
    } else if (message.type === "assistant") {
      const parts: V1Part[] = [part(message.id, "start", { type: "step-start" })]
      message.content.forEach((content, index) => {
        if (content.type === "text") parts.push(part(message.id, index, { type: "text", text: content.text }))
        else if (content.type === "reasoning") {
          const time = { start: content.time?.created ?? message.time.created, ...(content.time?.completed === undefined ? {} : { end: content.time.completed }) }
          parts.push(part(message.id, index, { type: "reasoning", text: content.text, time }))
        } else {
          parts.push(translateToolPart(content, { id: `${message.id}:${index}`, sessionID, messageID: message.id }))
        }
      })
      if (message.finish !== undefined) {
        parts.push(part(message.id, "finish", { type: "step-finish", reason: message.finish, cost: message.cost ?? 0, tokens: message.tokens ?? NO_TOKENS }))
      }
      result.push({
        info: {
          id: message.id,
          sessionID,
          role: "assistant",
          ...(parentID === undefined ? {} : { parentID }),
          agent: message.agent,
          mode: message.agent,
          providerID: message.model.providerID,
          modelID: message.model.id,
          ...(message.model.variant === undefined ? {} : { variant: message.model.variant }),
          ...(message.finish === undefined ? {} : { finish: message.finish }),
          cost: message.cost ?? 0,
          tokens: message.tokens ?? NO_TOKENS,
          path,
          ...(message.error === undefined ? {} : { error: toV1Error(message.error) }),
          time: {
            created: message.time.created,
            ...(message.time.completed === undefined ? {} : { completed: message.time.completed }),
          },
        },
        parts,
      })
    }
  }
  return result
}
