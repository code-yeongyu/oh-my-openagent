import type { JsonObject } from "../remote/ports"
import type { ThreadCloseOutcome } from "../tools/ports"
import { refuse } from "./port"

/**
 * How a leg answers one engine record for the ladder: the engine's reply data, or `gone` when the engine no longer
 * holds the session (`SESSION_GONE`). Every other failure the leg throws itself, typed the way that leg types it.
 */
export type RecordAnswer = { readonly kind: "ok"; readonly data: JsonObject } | { readonly kind: "gone"; readonly reason: string }

/** The engine's refusals that mean the session was not on it when the record arrived. */
export const SESSION_GONE: ReadonlySet<string> = new Set(["unknown_session", "session_identity_mismatch", "session_not_attached", "not_attached"])

/**
 * The one close ladder (#12879 audit 2), on this device's host and on another device alike. `unload_session` with
 * force ends the session for every client that holds it (senpi session-unload.ts); a session with no file yet cannot be
 * unloaded (`unsupported`), so it gets an attached `close_session`, which releases only this hold, and one `get_state`
 * probe: still answered, another client holds it; gone, it ended. A draining host is `host_unavailable`; any other
 * unload refusal is typed `unsupported` naming the engine's reason.
 */
export async function closeLadder(sessionId: string, send: (rpc: JsonObject) => Promise<RecordAnswer>): Promise<ThreadCloseOutcome> {
  const unload = await send({ type: "unload_session", sessionId, force: true, interrupt: true, children: "detach" })
  if (unload.kind === "gone") return "not_live"
  const reason = unload.data["reason"]
  if (unload.data["outcome"] === "unloaded") return "closed"
  if (reason === "session_closing") return "not_live"
  if (reason === "host_draining") throw refuse("host_unavailable", `The host holding thread ${sessionId} is shutting down and refused to close it.`, "Retry once that host has restarted.", { command: "unload_session", reason })
  if (reason !== "unsupported") throw refuse("unsupported", `The host holding thread ${sessionId} refused to close it (${String(reason)}).`, "Read the thread and retry once its work settles.", { command: "unload_session", reason, detail: unload.data["detail"] })
  const close = await send({ type: "close_session", sessionId })
  if (close.kind === "gone") return "not_live"
  const probe = await send({ type: "get_state", sessionId })
  return probe.kind === "gone" ? "closed" : "held_elsewhere"
}
