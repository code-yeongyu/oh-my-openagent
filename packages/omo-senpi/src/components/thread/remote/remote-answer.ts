import type { ThreadToolResult } from "../contracts"
import { threadToolFailure } from "../errors"
import { answerShape, isUiRequestKind, type UiRequestKind } from "../gateway/answer-shape"
import type { JsonObject, RemoteSessionRow, RemoteThreadSurface } from "./ports"
import { deviceOnline, outcomeFailure, replyData } from "./remote-ops"
import { isJsonObject } from "./session-state"

export type RemoteAnswer = { readonly kind: "text"; readonly text: string } | { readonly kind: "cancel" }

// What an answer is refused with once its session no longer waits on the request (senpi extension-ui-response.ts).
const NO_LONGER_WAITS: ReadonlySet<string> = new Set(["unknown_extension_ui_request", "question_already_resolved", "already_answered"])

function pendingKind(state: JsonObject, uiRequestId: string): UiRequestKind | null {
  for (const listed of [state["pendingDialogs"], state["pendingQuestions"]]) {
    if (!Array.isArray(listed)) continue
    const request = listed.find((candidate) => isJsonObject(candidate) && candidate["id"] === uiRequestId)
    if (isJsonObject(request)) return isUiRequestKind(request["method"]) ? request["method"] : null
  }
  return null
}

/**
 * Answers a dialog another device's session waits on, by its uiRequestId, from any client: the one that raised it or a
 * viewer that saw only its mirror (`ui_request_pending`). The text becomes the fields the request's kind reads, the kind
 * read from the session's own pending dialogs and questions (undeclared when it lists none, as a relayed question is).
 */
export async function answerRemote(remote: RemoteThreadSurface, row: RemoteSessionRow, uiRequestId: string, answer: RemoteAnswer): Promise<ThreadToolResult> {
  const offline = await deviceOnline(remote, row.device)
  if (offline !== undefined) return offline
  const label = `${row.device}/${row.session_id}`
  let fields: JsonObject = { cancelled: true }
  if (answer.kind === "text") {
    const state = await remote.sessions.sessionCommand(row.device, row.session_id, { type: "get_state", sessionId: row.session_id })
    if (state.kind !== "ok") return outcomeFailure(state, row.device)
    const shape = answerShape(pendingKind(replyData(state.response), uiRequestId), answer.text)
    if (!shape.ok) return { kind: "error", error: threadToolFailure("invalid_arguments", shape.reason, `Answer request ${uiRequestId} again in the shape it reads.`) }
    fields = shape.fields
  }
  const sent = await remote.sessions.sessionCommand(row.device, row.session_id, { type: "extension_ui_response", sessionId: row.session_id, id: uiRequestId, uiRequestId, ...fields })
  if (sent.kind === "refused" && NO_LONGER_WAITS.has(sent.reason))
    return { kind: "error", error: threadToolFailure("not_found", `${label} no longer waits on request ${uiRequestId} (${sent.reason}).`, `Watch ${label} for what it asks now; nothing was answered.`, { device: row.device, reason: sent.reason }) }
  if (sent.kind !== "ok") return outcomeFailure(sent, row.device)
  return { kind: "ok", thread_id: row.session_id, answered: { ui_request_id: uiRequestId }, device: row.device }
}
