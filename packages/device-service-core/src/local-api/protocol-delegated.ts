import type { EventOf, JsonObject } from "./protocol.ts"
import type { ChannelClosedReason } from "./vocabulary.ts"

// The delegated command channel on the local API v1 (DS2b, decision 0018). A client opts one session.command into its
// own delegated engine connection on the host with `delegated: true`, or addresses a host engine endpoint (a
// session-less record) with `endpoint`, a key it learns from session.endpoints. Every frame that engine connection writes
// unasked, and the reply of every delegated command, arrives as session.command_event on the connection that sent the
// command, in the engine's write order. A value too large for one line arrives as a blob of its UTF-8 JSON in
// session.command_blob_chunk events, ended by session.command_blob_done. session.channel_closed ends the channel toward
// that device exactly like a closed socket: the next delegated command opens a fresh one.
export type DelegatedRoute = { readonly delegated?: true; readonly endpoint?: string }
/**
 * Decision 0018 amendment 2026-11-06 (relay daemon #698): an endpoint `open_session`/`new_session` sent with
 * `locate: true` gets the new session as session.locate would answer it, `{key, session}`, on its reply event, from a
 * host that puts the key on its applied result (only toward a device with view standing). Without it the client
 * locates as before; a service before the amendment refuses the `locate` field as unknown (invalid_request).
 */
export type CommandLocated = { readonly key: string; readonly session: string }
export type SessionEndpoints = {
  readonly id: string
  readonly type: "session.endpoints"
  readonly device: string
}
export type SessionEndpointsData = { readonly endpoints: readonly string[] }
/**
 * #393 part B (decision 0005, amended 2026-11-04): the id of a session this client just created over an engine
 * endpoint, found by the durable engine session id in the create reply. Answered {device, key, session}: `key` is the
 * listing row's session_id, which session.attach takes.
 */
export type SessionLocate = {
  readonly id: string
  readonly type: "session.locate"
  readonly device: string
  readonly engine_id: string
}
export type SessionCandidate = {
  readonly device: string
  readonly key: string
  readonly session: string
}

export type CommandBlobRef = {
  readonly id: string
  readonly bytes: number
  readonly sha256: string
}
export type CommandEventBody =
  | { readonly frame: JsonObject }
  | { readonly command_id: string; readonly response: JsonObject; readonly located?: CommandLocated }
export type CommandEvent = EventOf<
  "session.command_event",
  { readonly device: string } & (CommandEventBody | { readonly blob: CommandBlobRef })
>
export type CommandBlobChunk = EventOf<
  "session.command_blob_chunk",
  { readonly id: string; readonly off: number; readonly b: string }
>
export type CommandBlobDone = EventOf<"session.command_blob_done", { readonly id: string }>
export type ChannelClosed = EventOf<
  "session.channel_closed",
  { readonly device: string; readonly reason: ChannelClosedReason }
>
export type DelegatedEvent = CommandEvent | CommandBlobChunk | CommandBlobDone | ChannelClosed
