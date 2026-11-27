import type { RpcObject } from "@oh-my-opencode/senpi-task/rpc-socket-client"

export type RpcRecord = RpcObject

/**
 * Which session the stream carries: a new one (the host's `open_session` fields, e.g. `cwd`, `kind`, `permissionPreset`,
 * `sessionPath` to reopen a saved session, `provider`/`modelId`, `thinkingLevel`, `retain_on_disconnect`, `context`), or
 * one already on the host, named by its durable id.
 */
export type RpcSessionTarget = { readonly open: RpcRecord } | { readonly attach: { readonly durableSessionId: string } }

export type AttachRpcSessionOptions = {
  /** The agent dir the host serves: the default endpoint (`<agentDir>/rpc/rpc.sock`) and key root. */
  readonly agentDir: string
  /** Another endpoint of a host (a shard, the desktop's host); the env's socket override, else the agent dir's. */
  readonly socket?: string
  readonly session: RpcSessionTarget
  /** Reads `SENPI_RPC_KEY_ROOT` and the socket overrides; `process.env` by default. */
  readonly env?: Readonly<Record<string, string | undefined>>
  /** How long open, attach and detach wait for the host's answer; 120 s by default (an open loads a session). */
  readonly requestTimeoutMs?: number
}

export type RpcSessionErrorCode =
  /** Nothing serves the endpoint. Start the host first (senpi `ensureHost`, or the thread SDK's `warmDaemon`). */
  | "not_running"
  /** The endpoint exists but this client cannot use it (permissions, a reset during connect). */
  | "unreachable"
  /** The host's identity or this client's proof failed (senpi docs/rpc.md "Authentication"). */
  | "auth_required"
  | "auth_failed"
  | "host_identity_unproven"
  | "unsafe_key_record"
  /** No session with that durable id on the host. */
  | "session_not_found"
  /** The host answered the open, attach or detach with a refusal; `message` carries its code. */
  | "refused"
  | "request_timeout"
  /** The connection ended before the host answered. */
  | "closed"

export type RpcSessionFailure = {
  readonly kind: "error"
  readonly error: { readonly code: RpcSessionErrorCode; readonly message: string }
}

export type RpcSessionEnd =
  /** `detach()` released or closed the session. */
  | "detached"
  /** The host closed the session (another client closed it, or it was unloaded). */
  | "session_closed"
  /** The session was released off this host. */
  | "session_released"
  /** The connection to the host ended. */
  | "connection_closed"

/**
 * One session on a host as the single-session pi-RPC stream `omo --mode rpc` speaks on stdio: records out, commands in,
 * with the host's multi-session routing (`sessionId` tags) handled here.
 */
export type RpcSessionStream = {
  /** The host's routing handle of the session. */
  readonly sessionId: string
  /** The durable id when the host reported one. */
  readonly durableSessionId?: string
  /**
   * This session's records in host order with `sessionId` removed: the records the host wrote before `open_session`
   * answered first, then every later one, plus the untagged answers to commands sent here. Another session's records
   * never arrive. Ends once, when `ended` settles. One consumer.
   */
  readonly records: AsyncIterable<RpcRecord>
  /** Sends one single-session pi-RPC command, tagged for this session; false once the stream ended. */
  readonly send: (record: RpcRecord) => boolean
  /**
   * Splits raw JSONL bytes from a client with the host's strict framing and sends each object record. Lines that are not
   * a JSON object are answered back in `rejected` (cut to 200 characters), never sent.
   */
  readonly write: (chunk: string | Uint8Array) => { readonly sent: number; readonly rejected: readonly string[] }
  /**
   * Ends the stream: `release_attachment` by default (the session keeps running and can be attached again), or
   * `close_session` with `close: true`. The connection closes either way; a refusal is answered as data.
   */
  readonly detach: (options?: { readonly close?: boolean }) => Promise<{ readonly kind: "ok" } | RpcSessionFailure>
  /** Settles once, with why the stream ended. */
  readonly ended: Promise<RpcSessionEnd>
}

export type AttachRpcSessionResult = { readonly kind: "ok"; readonly stream: RpcSessionStream } | RpcSessionFailure
