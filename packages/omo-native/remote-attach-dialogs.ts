import type { JsonObject } from "../device-service-core/src/index.ts"
import { raiserOnly } from "../omo-senpi/src/components/thread/remote/dialog-mirror"

// relayd sends a dialog in its local shape (`extension_ui_request`) only on the delegated connection that raised it; every
// other attach of the session sees the session's mirror of it instead, `ui_request_pending {uiRequestId, request}` and
// `ui_request_settled {uiRequestId, disposition}` (senpi modes/rpc/snapshot-types.ts). The attach TUI reads only the local
// shape, so the endpoint presents the mirror in it: a pending dialog as its own request frame under its uiRequestId, a
// settled one as the `question_resolved` the TUI dismisses a dialog on. The raiser gets both shapes for one id; the TUI
// shows a request id once.

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)

// Dialogs left pending when their settle never arrives (the session ended) stop being remembered past this many.
const SHOWN_KEPT = 1024

export class MirroredDialogs {
  readonly #shown = new Set<string>()

  /** The record the attach TUI gets for a dialog mirror record; null when the TUI must not see it; undefined for any other record. */
  present(record: JsonObject, sessionId: string): JsonObject | null | undefined {
    const uiRequestId = record["uiRequestId"]
    if (typeof uiRequestId !== "string" || uiRequestId === "") return undefined
    if (record["type"] === "ui_request_settled") {
      this.#shown.delete(uiRequestId)
      return {
        type: "question_resolved",
        id: uiRequestId,
        outcome: record["disposition"] === "answered" ? "answered" : "cancelled",
        sessionId,
      }
    }
    if (record["type"] !== "ui_request_pending") return undefined
    const request = record["request"]
    if (!isObject(request) || raiserOnly(request)) return null
    this.#shown.add(uiRequestId)
    for (const oldest of this.#shown) if (this.#shown.size > SHOWN_KEPT) this.#shown.delete(oldest)
    return { ...request, type: "extension_ui_request", id: uiRequestId, sessionId }
  }

  /** The TUI answers a presented dialog by the id it was shown, its uiRequestId: the answer names it so. Others go as they are. */
  answer(record: JsonObject): JsonObject {
    const id = record["id"]
    if (
      record["type"] !== "extension_ui_response" ||
      typeof id !== "string" ||
      record["uiRequestId"] !== undefined ||
      !this.#shown.has(id)
    )
      return record
    return { ...record, uiRequestId: id }
  }
}

/** The snapshot state with the frames only their raiser may answer removed: the TUI runs every pending frame it
 *  receives through its own dialog path without that filter, so they must never leave this process (#13482 review). */
export const withoutRaiserOnly = (state: JsonObject): JsonObject => {
  const out: Record<string, unknown> = { ...state }
  for (const field of ["pendingDialogs", "pendingQuestions"]) {
    const list = state[field]
    if (!Array.isArray(list)) continue
    out[field] = list.filter((entry) => typeof entry !== "object" || entry === null || !raiserOnly(entry as JsonObject))
  }
  return out as JsonObject
}
