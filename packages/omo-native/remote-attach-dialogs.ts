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

const remember = (known: Set<string>, uiRequestId: string): void => {
  known.add(uiRequestId)
  for (const oldest of known) if (known.size > SHOWN_KEPT) known.delete(oldest)
}

/** Every request id a snapshot's pending lists hold (`state.pendingDialogs`, `state.pendingQuestions`). */
export const pendingIds = (...lists: readonly unknown[]): Set<string> =>
  new Set(
    lists.flatMap((list) =>
      Array.isArray(list)
        ? list.flatMap((request) => (isObject(request) && typeof request["id"] === "string" ? [request["id"]] : []))
        : [],
    ),
  )

export class MirroredDialogs {
  readonly #shown = new Set<string>()
  // Raiser-only dialogs (secret input, grant selection) pending on the session: never shown here, but the raiser's TUI got
  // them through its own delegated frame, so a snapshot that no longer holds one must still dismiss it there.
  readonly #raiserOnly = new Set<string>()

  /** The record the attach TUI gets for a dialog mirror record; null when the TUI must not see it; undefined for any other record. */
  present(record: JsonObject, sessionId: string): JsonObject | null | undefined {
    const uiRequestId = record["uiRequestId"]
    if (typeof uiRequestId !== "string" || uiRequestId === "") return undefined
    if (record["type"] === "ui_request_settled") {
      this.#shown.delete(uiRequestId)
      this.#raiserOnly.delete(uiRequestId)
      return {
        type: "question_resolved",
        id: uiRequestId,
        outcome: record["disposition"] === "answered" ? "answered" : "cancelled",
        sessionId,
      }
    }
    if (record["type"] !== "ui_request_pending") return undefined
    const request = record["request"]
    if (!isObject(request)) return null
    if (raiserOnly(request)) {
      remember(this.#raiserOnly, uiRequestId)
      return null
    }
    remember(this.#shown, uiRequestId)
    return { ...request, type: "extension_ui_request", id: uiRequestId, sessionId }
  }

  /**
   * A snapshot's pending dialogs or questions (`state.pendingDialogs` / `state.pendingQuestions`, whose `id` is the
   * uiRequestId): the ones this TUI may answer, in the local shape, each remembered so its answer names it (omo#13474).
   */
  pending(requests: unknown, sessionId: string): JsonObject[] {
    if (!Array.isArray(requests)) return []
    return requests.flatMap((request) => {
      if (!isObject(request) || typeof request["id"] !== "string" || request["id"] === "") return []
      if (raiserOnly(request)) {
        remember(this.#raiserOnly, request["id"])
        return []
      }
      remember(this.#shown, request["id"])
      return [{ ...request, type: "extension_ui_request", sessionId }]
    })
  }

  /**
   * After a later snapshot (a re-attach): the resolution of each dialog this TUI was shown, or that its raiser holds, that
   * the snapshot no longer holds. It settled while the attach was away and its settle record was lost with the gap, so
   * the TUI dismisses it. `still` is every request id the snapshot holds (`pendingIds`), raiser-only ones included.
   */
  settledAway(still: ReadonlySet<string>, sessionId: string): JsonObject[] {
    return [this.#shown, this.#raiserOnly].flatMap((known) =>
      [...known].flatMap((uiRequestId) => {
        if (still.has(uiRequestId)) return []
        known.delete(uiRequestId)
        return [{ type: "question_resolved", id: uiRequestId, outcome: "cancelled", sessionId }]
      }),
    )
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
