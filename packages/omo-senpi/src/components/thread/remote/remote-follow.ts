import type { ThreadToolFailure } from "../errors"
import type { JsonObject, RemoteResync, RemoteSessionRow, RemoteSessionState, RemoteStatusChange, RemoteThreadSurface, RemoteWatchEnd } from "./ports"
import { raiserOnly } from "./dialog-mirror"
import { deviceOnline, outcomeFailure } from "./remote-ops"
import { isJsonObject } from "./session-state"

type Failure = { readonly kind: "error"; readonly error: ThreadToolFailure }

export type RemoteFollow = {
  /** "settled" once the session's run settles (`agent_settled`), "session_closed" when its close cut the run short, else why the watch ended first. */
  readonly settled: Promise<string>
  readonly stop: () => void
}

const NOT_RUNNING: ReadonlySet<string> = new Set(["idle", "closed", "unloaded"])

/**
 * Follows another device's session from now on: each assistant text delta (`message_update` / `text_delta`) goes to
 * `onText` in the order the session wrote it, until its run settles, with a line break between the text of separate
 * messages or content blocks. Start it before the send it follows. A relay drop or a device-service restart in between
 * is resynced, so a run that settled while the follow could not see it still settles the follow.
 */
export async function followRemote(remote: RemoteThreadSurface, row: RemoteSessionRow, onText: (text: string) => void): Promise<RemoteFollow | Failure> {
  const offline = await deviceOnline(remote, row.device)
  if (offline !== undefined) return offline
  let settle!: (end: string) => void
  const settled = new Promise<string>((resolve) => { settle = resolve })
  let last: { readonly index: unknown; readonly endsLine: boolean } | undefined
  let newMessage = false
  let running = false
  const watched = await remote.sessions.watch(row.device, row.session_id, {
    record: (record) => {
      // senpi settles a turn the session's close cut short with reason session_closed: that turn never finished.
      if (record["type"] === "agent_settled") return settle(record["reason"] === "session_closed" ? "session_closed" : "settled")
      if (record["type"] === "message_start" || record["type"] === "message_end") newMessage = true
      const event = record["assistantMessageEvent"]
      if (record["type"] !== "message_update" || !isJsonObject(event) || event["type"] !== "text_delta" || typeof event["delta"] !== "string" || event["delta"] === "") return
      const delta = event["delta"]
      if (last !== undefined && !last.endsLine && (newMessage || event["contentIndex"] !== last.index)) onText("\n")
      newMessage = false
      last = { index: event["contentIndex"], endsLine: delta.endsWith("\n") }
      onText(delta)
    },
    status: (change) => { if (change.to === "running") running = true },
    resynced: (resync) => {
      if (resync.settledTurns.length > 0 || (running && NOT_RUNNING.has(resync.state.status))) settle(resync.state.status === "closed" ? "session_closed" : "settled")
    },
  })
  if (watched.kind !== "ok") return outcomeFailure(watched, row.device)
  void watched.watch.ended.then(settle)
  return { settled, stop: watched.watch.stop }
}

export type RemoteWatchEvent =
  | { readonly kind: "status"; readonly change: RemoteStatusChange }
  | { readonly kind: "settled"; readonly turnId?: string; readonly reason?: string }
  | { readonly kind: "resynced"; readonly resync: RemoteResync }
  | { readonly kind: "lost"; readonly reason: string }
  | { readonly kind: "record"; readonly record: JsonObject }
  /** A dialog the session waits on, raised by any client; answered by its uiRequestId. */
  | { readonly kind: "dialog"; readonly uiRequestId: string; readonly request: JsonObject }
  /** `settled_while_detached`: shown before a gap, and no longer pending when the watch could see the session again. */
  | { readonly kind: "dialog_settled"; readonly uiRequestId: string; readonly disposition: "answered" | "cancelled" | "settled_while_detached" }

export type RemoteSessionFollow = { readonly initial: RemoteSessionState; readonly ended: Promise<RemoteWatchEnd>; readonly stop: () => void }

/**
 * Watches another device's session until it closes or the access ends: its status changes and turn ends as they
 * happen, and after any gap (relay drop, device-service restart, engine restart) what changed meanwhile, once.
 * Every dialog the session waits on, and its settling, is passed too, once per request: the ones pending when the watch
 * starts and after every resync (a watch is no dialog's raiser and sees live ones only as the session's mirror, senpi
 * snapshot-types.ts), never one only its raiser may answer. `records: true` also passes every other record the session writes.
 */
export async function watchRemote(remote: RemoteThreadSurface, row: RemoteSessionRow, onEvent: (event: RemoteWatchEvent) => void, options: { readonly records?: boolean } = {}): Promise<RemoteSessionFollow | Failure> {
  const offline = await deviceOnline(remote, row.device)
  if (offline !== undefined) return offline
  const shown = new Set<string>()
  const show = (uiRequestId: string, request: JsonObject): void => {
    if (shown.has(uiRequestId) || raiserOnly(request)) return
    shown.add(uiRequestId)
    onEvent({ kind: "dialog", uiRequestId, request })
  }
  const settle = (uiRequestId: string, disposition: "answered" | "cancelled" | "settled_while_detached"): void => {
    if (shown.delete(uiRequestId)) onEvent({ kind: "dialog_settled", uiRequestId, disposition })
  }
  // A fresh read lists every request still pending; after a gap, one shown before and no longer listed settled meanwhile.
  const showPending = (state: RemoteSessionState, afterGap: boolean): void => {
    if (state.pendingRequests === undefined) return
    const listed = new Map(state.pendingRequests.flatMap((request) => (typeof request["id"] === "string" && request["id"] !== "" ? [[request["id"], request] as const] : [])))
    if (afterGap) for (const uiRequestId of [...shown]) if (!listed.has(uiRequestId)) settle(uiRequestId, "settled_while_detached")
    for (const [uiRequestId, request] of listed) show(uiRequestId, request)
  }
  const watched = await remote.sessions.watch(row.device, row.session_id, {
    record: (record) => {
      const uiRequestId = record["uiRequestId"]
      const request = record["request"]
      if (record["type"] === "ui_request_pending" && typeof uiRequestId === "string" && uiRequestId !== "" && isJsonObject(request)) return show(uiRequestId, request)
      if (record["type"] === "ui_request_settled" && typeof uiRequestId === "string") return settle(uiRequestId, record["disposition"] === "answered" ? "answered" : "cancelled")
      if (record["type"] === "agent_settled") {
        const turnId = record["turnId"]
        const reason = record["reason"]
        return onEvent({ kind: "settled", ...(typeof turnId === "string" ? { turnId } : {}), ...(typeof reason === "string" ? { reason } : {}) })
      }
      if (options.records === true && record["type"] !== "session_status") onEvent({ kind: "record", record })
    },
    status: (change) => onEvent({ kind: "status", change }),
    resynced: (resync) => {
      onEvent({ kind: "resynced", resync })
      showPending(resync.state, true)
    },
    lost: (reason) => onEvent({ kind: "lost", reason }),
  }, { baseline: true })
  if (watched.kind !== "ok") return outcomeFailure(watched, row.device)
  const { initial } = watched.watch
  if (initial === undefined) {
    watched.watch.stop()
    return outcomeFailure({ kind: "refused", reason: "state_unread" }, row.device)
  }
  showPending(initial, false)
  return { initial, ended: watched.watch.ended, stop: watched.watch.stop }
}
