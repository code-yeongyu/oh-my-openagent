import type { ThreadToolResult } from "../contracts"
import { threadToolFailure } from "../errors"
import { answerShape, isUiRequestKind } from "../gateway/answer-shape"
import { raiserOnly } from "./dialog-mirror"
import type { JsonObject, RemoteCommandOutcome, RemoteSessionRow, RemoteThreadSurface } from "./ports"
import { deviceOnline, outcomeFailure, replyData } from "./remote-ops"
import { sessionStateOf } from "./session-state"

export type RemoteAnswer = { readonly kind: "text"; readonly text: string } | { readonly kind: "cancel" }

// What an answer is refused with once its session no longer waits on the request (senpi extension-ui-response.ts and
// the terminal control endpoint's `unknown_request`).
const NO_LONGER_WAITS: ReadonlySet<string> = new Set(["unknown_extension_ui_request", "unknown_request", "question_already_resolved", "already_answered"])

// relayd ends an answer `engine_stale` only when its own check finds the dialog already settled, or the answer lost the
// race to another one (relayd remote-commands.ts, remote-command-verdict.ts): it never reached the engine.
const notAnswered = (outcome: RemoteCommandOutcome): boolean =>
  (outcome.kind === "refused" && NO_LONGER_WAITS.has(outcome.reason)) || (outcome.kind === "uncertain" && outcome.reason === "engine_stale")

const reasonOf = (outcome: RemoteCommandOutcome): string => (outcome.kind === "ok" ? "" : outcome.reason)

/**
 * Answers a dialog another device's session waits on, by its uiRequestId, from any client: the one that raised it or a
 * viewer that saw only its mirror (`ui_request_pending`). The text becomes the fields the request's kind reads, the kind
 * read from the session's own pending dialogs and questions (undeclared when it lists none, as a relayed question is).
 */
export async function answerRemote(remote: RemoteThreadSurface, row: RemoteSessionRow, uiRequestId: string, answer: RemoteAnswer): Promise<ThreadToolResult> {
  const offline = await deviceOnline(remote, row.device)
  if (offline !== undefined) return offline
  const label = `${row.device}/${row.session_id}`
  const state = await remote.sessions.sessionCommand(row.device, row.session_id, { type: "get_state", sessionId: row.session_id })
  if (state.kind !== "ok") return outcomeFailure(state, row.device)
  const pending = sessionStateOf(row.session_id, replyData(state.response)).pendingRequests?.find((request) => request["id"] === uiRequestId)
  if (pending !== undefined && raiserOnly(pending))
    return { kind: "error", error: threadToolFailure("scope_denied", `Request ${uiRequestId} can be answered only on the device whose prompt raised it.`, "Answer it on that device; nothing was sent.", { device: row.device }) }
  let fields: JsonObject = { cancelled: true }
  if (answer.kind === "text") {
    const shape = answerShape(isUiRequestKind(pending?.["method"]) ? pending["method"] : null, answer.text)
    if (!shape.ok) return { kind: "error", error: threadToolFailure("invalid_arguments", shape.reason, `Answer request ${uiRequestId} again in the shape it reads.`) }
    fields = shape.fields
  }
  const sent = await remote.sessions.sessionCommand(row.device, row.session_id, { type: "extension_ui_response", sessionId: row.session_id, id: uiRequestId, uiRequestId, ...fields })
  if (notAnswered(sent))
    return { kind: "error", error: threadToolFailure("not_found", `${label} no longer waits on request ${uiRequestId} (${reasonOf(sent)}).`, `Watch ${label} for what it asks now; nothing was answered.`, { device: row.device, reason: reasonOf(sent) }) }
  if (sent.kind !== "ok") return outcomeFailure(sent, row.device)
  return { kind: "ok", thread_id: row.session_id, answered: { ui_request_id: uiRequestId }, device: row.device }
}
