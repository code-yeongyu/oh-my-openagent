import { createHmac, randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fakeHostTransport } from "../__fixtures__/fake-host-transport"

type Frame = Record<string, unknown>
export type ContractHostOptions = {
  readonly legacy?: boolean
  readonly auth?: boolean
  readonly durableId?: string
  readonly otherAttachments?: number
  readonly badProof?: boolean
  readonly prepareRecord?: (path: string, root: string) => void
  /** attach_session refusals: a draining host (v1 session_busy_lifecycle + host_draining) or a caller with no connection (v1.1). */
  readonly attachRefusal?: "host_draining" | "session_not_attached" | "unknown_session"
  /** The first release_session fails with release_failed after tearing the session down far enough that it is gone. */
  readonly releaseFailsThenGone?: boolean
  /** An out-of-contract host that answers release_attachment for a released session with unknown_session. */
  readonly releasedAttachmentAnswer?: "unknown_session"
  /** After a mutation succeeds: the host drops the attachment itself, or the connection is lost before release answers. */
  readonly afterMutation?: "detached" | "connection_lost"
  /** Agent dir the key record is written under (`<keyRoot>/rpc/keys/<launch_id>`); the host's temp root by default. */
  readonly keyRoot?: string
  /** Writes a line that is not JSON before every response, as a host's stray output would. */
  readonly strayLine?: boolean
  /** Delays the get_protocol_info answer, to measure the client's total deadline. */
  readonly protocolDelayMs?: number
  /** Commands the host reads but never answers. */
  readonly silent?: readonly string[]
  /** An older host that refuses get_protocol_info itself. */
  readonly refuseProtocolInfo?: boolean
  /** Refuses any client proof with auth_failed (frame 4). */
  readonly rejectProof?: boolean
  /** A session with no file yet: unload_session refuses it `unsupported` (senpi session-unload.ts `loaded`). */
  readonly unwritten?: boolean
  /** unload_session answers `{outcome: "refused", reason}` with this reason, as data, whatever else is set. */
  readonly unloadRefusal?: string
  /**
   * The session's history (entries with an `id`): get_entries pages it backward as the engine does (`{before, tail}`,
   * answering `next_before`; an unknown `before` is refused not_found), and get_snapshot answers its newest `tail`
   * entries (100 by default) with history_truncated and next_before, as the engine does.
   */
  readonly history?: readonly Frame[]
  /** Refuse an unpaged get_entries over this many entries `response_too_large` (the engine's 48 MiB answer cap). */
  readonly unpagedCap?: number
  /**
   * Records of the session written ahead of get_snapshot's answer, then the engine's `snapshot_marker`: the snapshot
   * already holds them, as the engine takes it before it writes the marker and the answer (get-snapshot.js).
   */
  readonly beforeSnapshot?: readonly Frame[]
  /** The session's status in a `subscribe_sessions` snapshot ("idle" by default). */
  readonly subscribeStatus?: string
  /** Records written right behind the `subscribe_sessions` answer, before the client could read its snapshot. */
  readonly afterSubscribe?: readonly Frame[]
  /** `subscribe_sessions` is refused with this error code. */
  readonly subscribeRefusal?: string
  /** The turn `get_state` reports running (`currentTurnId`), as the engine does while a run is under way. */
  readonly currentTurnId?: string
  /** What `get_state` answers, whole, instead of the default: the host's state when the read lands. */
  readonly state?: Frame
}
export type ContractHost = {
  readonly socket: string
  readonly root: string
  readonly recordPath: string
  readonly frames: { readonly connection: number; readonly frame: Frame }[]
  readonly mutations: Frame[]
  readonly permissionPreset: () => string
  /**
   * Starts the host's drain, as a real host does when it is superseded: every connection that arrives
   * afterwards is disconnected before any frame is read, and an already admitted connection sees
   * attach_session / reclaim_session refused `session_busy_lifecycle` + `host_draining`.
   */
  readonly drain: () => void
  /** Whether the session is still on the host: false once a close or an unload ended it. */
  readonly live: () => boolean
  /**
   * Settles once an attached connection's get_snapshot was answered: a test awaits it before it pushes records that must
   * stream, since the records written before the snapshot's marker are the snapshot's own (get-snapshot.js).
   */
  readonly snapshotted: () => Promise<void>
  /** Writes these records of the session (`sessionId` "rpc-1") to every connection attached to it, as a live host does. */
  readonly push: (records: readonly Frame[]) => void
  /** Settles once a `subscribe_sessions` was answered. */
  readonly subscribed: () => Promise<void>
  /**
   * Writes records to every subscribed connection as the host's status stream does: `session_status` always, any
   * other record only when its type is in the subscription's `mirror`; `sessionId` "rpc-1" unless the record names one.
   */
  readonly publish: (records: readonly Frame[]) => void
  /** Ends every subscribed connection from the host's side. */
  readonly dropSubscribers: () => void
}

/**
 * The real host's attachment-gate exemptions (senpi `session-attachment-gate.ts` ATTACH_GATE_EXEMPT):
 * a connection that holds no attachment may still send these session commands.
 */
export const ATTACH_GATE_EXEMPT: ReadonlySet<string> = new Set([
  "get_protocol_info",
  "list_sessions",
  "subscribe_sessions",
  "unsubscribe_sessions",
  "get_subscription_limits",
  "warm",
  "detach_connection",
  "open_session",
  "attach_session",
  "reclaim_session",
  "get_effect_status",
  "get_state",
  "get_messages",
  "get_entries",
  "get_tree",
  "get_fork_messages",
  "get_last_assistant_text",
  "get_media",
  "get_commands",
  "get_loaded_surfaces",
  "get_available_models",
  "get_available_thinking_levels",
  "get_fast_mode",
  "get_session_stats",
  "get_pending_inputs",
  "get_steering_messages",
  "get_follow_up_messages",
  "get_auth_providers",
  "get_provider_accounts",
  "resolve_path",
  "memory_report",
  "eval_cells.list",
  "eval_cells.peek",
  "check_reload_veto",
])

/** Enforces the public v1.1 wire contract, including connection-local attachment ownership. */
export async function withContractHost(
  options: ContractHostOptions,
  exercise: (host: ContractHost) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "rpc-client-"))
  const socket = join(root, "rpc.sock")
  const transport = fakeHostTransport(socket)
  const launchId = randomUUID()
  const key = randomBytes(32)
  const keyRoot = options.keyRoot ?? root
  const recordPath = join(keyRoot, "rpc", "keys", launchId)
  mkdirSync(join(keyRoot, "rpc", "keys"), { recursive: true, mode: 0o700 })
  for (const directory of [keyRoot, join(keyRoot, "rpc")]) chmodSync(directory, 0o700)
  writeFileSync(
    recordPath,
    JSON.stringify({
      version: 1,
      launch_id: launchId,
      key: key.toString("hex"),
      pid: process.pid,
      process_start: null,
      endpoint: socket,
      created_at: new Date().toISOString(),
    }),
    { mode: 0o600 },
  )
  options.prepareRecord?.(recordPath, root)
  const frames: ContractHost["frames"] = []
  const mutations: Frame[] = []
  const sockets = new Set<Socket>()
  const attachedClients = new Set<Socket>()
  const firstSnapshot = Promise.withResolvers<void>()
  const firstSubscribe = Promise.withResolvers<void>()
  const subscribers = new Map<Socket, ReadonlySet<string>>()
  const streamed = (record: Frame) => `${JSON.stringify({ sessionId: "rpc-1", ...record })}\n`
  const mirrored = (mirror: ReadonlySet<string>, record: Frame) =>
    record.type === "session_status" || mirror.has(String(record.type))
  let nextConnection = 0
  let preset = "read-only"
  const durableId = options.durableId ?? "dur-selected"
  const sessionPath = join(root, "session.jsonl")
  const session = () => ({ sessionId: "rpc-1", durableSessionId: durableId, sessionPath, cwd: root, name: "target" })
  // Host-wide, unlike attachments: a session that left the host is unknown to every later connection.
  let gone = options.attachRefusal === "unknown_session"
  let draining = false
  // Ended by a close or an unload: gone for every connection and no longer listed.
  let ended = false
  const server = createServer((client) =>
    transport.authenticate(client, () => {
      // A draining host disconnects a newly arriving client; only an admitted connection sees the attach refusal.
      if (draining) {
        client.destroy()
        return
      }
      const connection = nextConnection++
      sockets.add(client)
      client.once("close", () => sockets.delete(client))
      let buffer = ""
      let authenticated = process.platform === "win32" || options.auth !== true
      let attached = false
      let expectedProof = ""
      let released = false
      // A refusal's errorCode is its error, unless the engine sends a message with a code of its own (`errorCode`).
      const respond = (frame: Frame, data: unknown = {}, error?: string, errorData?: Frame, errorCode = error) =>
        client.write(
          `${options.strayLine ? "not json\n" : ""}${JSON.stringify({
            id: frame.id,
            type: "response",
            command: frame.type,
            success: error === undefined,
            ...(error === undefined
              ? { data }
              : { error, errorCode, ...(errorData === undefined ? {} : { errorData }) }),
          })}\n`,
        )
      // Wire frames 4 and 5: an auth refusal is answered, then the host closes the connection.
      const refuseAndClose = (frame: Frame, error: "auth_required" | "auth_failed") => {
        respond(frame, undefined, error)
        client.end()
      }
      client.setEncoding("utf8")
      client.on("data", (chunk: string) => {
        buffer += chunk
        for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
          const frame = JSON.parse(buffer.slice(0, newline)) as Frame
          buffer = buffer.slice(newline + 1)
          frames.push({ connection, frame })
          if (options.silent?.includes(String(frame.type))) continue
          if (frame.type === "get_protocol_info" && options.refuseProtocolInfo) {
            respond(frame, undefined, "unknown_command")
            continue
          }
          if (frame.type === "get_protocol_info") {
            const capabilities = options.legacy ? [] : ["attach_session", "release_attachment", "release_caller_aware"]
            if (options.auth && process.platform !== "win32") {
              const clientNonce = (frame.auth as { client_nonce?: string } | undefined)?.client_nonce
              if (typeof clientNonce !== "string" || !/^[0-9a-f]{64}$/.test(clientNonce)) {
                refuseAndClose(frame, "auth_required")
                continue
              }
              const serverNonce = randomBytes(32).toString("hex")
              const proof = (label: string, first: string, second: string) =>
                createHmac("sha256", key).update([label, launchId, first, second].join("\n"), "utf8").digest("hex")
              expectedProof = proof("senpi-rpc-client", serverNonce, clientNonce)
              const answer = {
                capabilities: [...capabilities, "socket_auth"],
                auth: {
                  launch_id: launchId,
                  server_nonce: serverNonce,
                  server_proof: options.badProof ? "0".repeat(64) : proof("senpi-rpc-server", clientNonce, serverNonce),
                },
              }
              if (options.protocolDelayMs === undefined) respond(frame, answer)
              else setTimeout(() => respond(frame, answer), options.protocolDelayMs)
            } else respond(frame, { capabilities })
            continue
          }
          if (frame.type === "authenticate") {
            authenticated = !options.rejectProof && frame.client_proof === expectedProof && expectedProof !== ""
            if (authenticated) respond(frame, {})
            else refuseAndClose(frame, "auth_failed")
            continue
          }
          if (!authenticated) {
            refuseAndClose(frame, "auth_required")
            continue
          }
          if (frame.type === "attach_session") {
            if (draining || options.attachRefusal === "host_draining")
              respond(frame, undefined, "session_busy_lifecycle", { reason: "host_draining" })
            else if (options.attachRefusal === "session_not_attached")
              respond(frame, undefined, "session_not_attached", { reason: "no_connection" })
            else if (gone) respond(frame, undefined, "unknown_session", {})
            else if (frame.sessionId !== "rpc-1" || frame.durableSessionId !== durableId) {
              respond(frame, undefined, "session_identity_mismatch", {})
            } else {
              attached = true
              attachedClients.add(client)
              client.once("close", () => attachedClients.delete(client))
              respond(frame, { sessionId: "rpc-1", attached: true })
            }
            continue
          }
          if (frame.type === "release_attachment") {
            if (options.afterMutation === "connection_lost") {
              client.destroy()
              continue
            }
            if (released && options.releasedAttachmentAnswer === "unknown_session")
              respond(frame, undefined, "unknown_session")
            else if (attached && !released) respond(frame, { deferred: false })
            else respond(frame, undefined, "session_not_attached", { reason: "not_attached" })
            attached = false
            continue
          }
          if (frame.type === "reclaim_session") {
            if (draining || options.attachRefusal === "host_draining")
              respond(frame, undefined, "session_busy_lifecycle", { reason: "host_draining" })
            else if (options.attachRefusal === "session_not_attached")
              respond(frame, undefined, "session_not_attached", { reason: "no_connection" })
            else if (frame.durableSessionId !== durableId) respond(frame, undefined, "session_identity_mismatch", {})
            else {
              attached = true
              respond(frame, { reclaimed: true, sessionId: "rpc-1" })
            }
            continue
          }
          if (frame.type === "list_sessions") {
            respond(frame, { sessions: ended ? [] : [session()] })
            continue
          }
          if (frame.type === "subscribe_sessions") {
            if (options.subscribeRefusal !== undefined) {
              respond(frame, undefined, options.subscribeRefusal)
              continue
            }
            const mirror = new Set(Array.isArray(frame.mirror) ? frame.mirror.map(String) : [])
            subscribers.set(client, mirror)
            client.once("close", () => subscribers.delete(client))
            const row = { type: "session_status", ...session(), status: options.subscribeStatus ?? "idle" }
            respond(frame, { subscriptionId: "sub-1", snapshot: ended ? [] : [row], seq: 0 })
            for (const record of options.afterSubscribe ?? [])
              if (mirrored(mirror, record)) client.write(streamed(record))
            firstSubscribe.resolve()
            continue
          }
          if (frame.type === "warm") {
            respond(frame, { warmed: true })
            continue
          }
          if (frame.type === "open_session") {
            attached = true
            if (typeof frame.permissionPreset === "string") preset = frame.permissionPreset
            respond(frame, { sessionId: "rpc-1", state: session() })
            continue
          }
          // A multi-session host routes every other command by `sessionId` (senpi `session-router-routing.ts`):
          // one that names no session is refused before it reaches any session, an older host included.
          if (frame.sessionId === undefined || frame.sessionId === "") {
            respond(frame, undefined, "missing_session_id")
            continue
          }
          // Only session-scoped commands are gated, as the host's attachment gate reads `sessionId`; its exempt reads pass.
          // close_session skips the gate, but close() refuses a connection that holds no attachment with unknown_session
          // and releases nothing (senpi session-router-close.ts close(), senpi#1782). An attached close releases only the
          // caller's hold (drainAttachments: false), so the session ends only when no other client holds it.
          if (frame.type === "close_session") {
            if (gone || (!options.legacy && !attached)) {
              respond(frame, undefined, "unknown_session", {})
              continue
            }
            attached = false
            mutations.push(frame)
            if (!options.otherAttachments) {
              gone = true
              ended = true
            }
            respond(frame, {})
            continue
          }
          if (!options.legacy && !attached && !ATTACH_GATE_EXEMPT.has(String(frame.type))) {
            respond(frame, undefined, "session_not_attached", {
              reason: "this connection is not attached to that session",
              action:
                "attach first with attach_session { sessionId, durableSessionId } or open_session { sessionPath }",
            })
            continue
          }
          // unload_session answers its refusals as data (senpi session-unload.ts): a session with no file is unsupported,
          // other holders refuse it unless force; otherwise every attachment is drained and the session ends for all.
          if (frame.type === "unload_session") {
            if (options.unloadRefusal !== undefined) {
              respond(frame, {
                outcome: "refused",
                reason: options.unloadRefusal,
                detail: `refused: ${options.unloadRefusal}`,
              })
              continue
            }
            if (options.unwritten) {
              respond(frame, {
                outcome: "refused",
                reason: "unsupported",
                detail: "the session has no file to reopen it by",
              })
              continue
            }
            if (options.otherAttachments && frame.force !== true) {
              respond(frame, {
                outcome: "refused",
                reason: "attached",
                detail: `${options.otherAttachments} other client(s) attached`,
              })
              continue
            }
            mutations.push(frame)
            gone = true
            ended = true
            attached = false
            respond(frame, { outcome: "unloaded", sessionPath })
            continue
          }
          if (frame.type === "get_messages") {
            respond(frame, { messages: [] })
            continue
          }
          if (frame.type === "get_state") {
            respond(
              frame,
              options.state ??
                (options.currentTurnId === undefined
                  ? { isStreaming: false }
                  : { isStreaming: true, currentTurnId: options.currentTurnId }),
            )
            continue
          }
          // senpi modes/rpc/get-entries-command.js: an unknown `before` is refused RPC_ERROR_ENTRY_NOT_FOUND ("not_found"),
          // a page size below one RPC_ERROR_INVALID_ARGUMENT; only a paged (tail) answer carries hasMore.
          if (frame.type === "get_entries" && options.history !== undefined) {
            const all = options.history
            const before =
              typeof frame.before === "string" ? all.findIndex((entry) => entry.id === frame.before) : all.length
            if (before < 0) {
              respond(frame, undefined, `Entry not found: ${String(frame.before)}`, undefined, "not_found")
              continue
            }
            const tail = frame.tail
            if (tail !== undefined && !(typeof tail === "number" && Number.isInteger(tail) && tail > 0)) {
              respond(frame, undefined, "tail must be a positive integer", undefined, "invalid_argument")
              continue
            }
            if (tail === undefined && options.unpagedCap !== undefined && before > options.unpagedCap) {
              respond(frame, undefined, "response_too_large")
              continue
            }
            const page = all.slice(tail === undefined ? 0 : Math.max(0, before - tail), before)
            const older = before - page.length > 0
            respond(frame, {
              entries: page,
              ...(tail === undefined ? {} : { hasMore: older }),
              ...(older ? { next_before: page[0]?.id } : {}),
            })
            continue
          }
          // senpi modes/rpc/get-snapshot.js: the newest `tail` entries (100 by default), history_truncated when older ones
          // remain, next_before the oldest one sent; connection-handler.js writes the marker on every routed connection
          // (each of this host's is), after what the snapshot already holds and before the answer.
          if (frame.type === "get_snapshot") {
            const tail = frame.tail ?? 100
            if (!(typeof tail === "number" && Number.isSafeInteger(tail) && tail >= 0)) {
              respond(frame, undefined, "tail must be a non-negative integer", undefined, "invalid_argument")
              continue
            }
            const history = options.history ?? []
            const entries = tail === 0 ? [] : history.slice(-tail)
            const truncated = entries.length < history.length
            const markerId = randomUUID()
            for (const record of options.beforeSnapshot ?? [])
              client.write(`${JSON.stringify({ ...record, sessionId: "rpc-1" })}\n`)
            client.write(`${JSON.stringify({ type: "snapshot_marker", markerId, sessionId: "rpc-1" })}\n`)
            respond(frame, {
              state: { sessionId: "rpc-1", isStreaming: false, pendingDialogs: [] },
              entries,
              history_truncated: truncated,
              next_before: truncated ? (entries[0]?.id ?? null) : null,
              markerId,
            })
            if (attached) firstSnapshot.resolve()
            continue
          }
          if (frame.type === "get_available_models") {
            respond(frame, { models: [{ provider: "p", id: "m" }] })
            continue
          }
          if (frame.type === "get_available_thinking_levels") {
            respond(frame, { levels: ["off", "high"] })
            continue
          }
          if (frame.type === "release_session" && options.releaseFailsThenGone && !gone) {
            gone = true
            respond(frame, undefined, "release_failed", { detail: "the hand-over entry could not be written" })
            continue
          }
          if (frame.type === "release_session" && options.otherAttachments && frame.force !== true) {
            respond(frame, undefined, "attached")
            continue
          }
          mutations.push(frame)
          if (options.afterMutation === "detached") attached = false
          // A released session leaves the host, so a later release_attachment names a session it no longer knows.
          if (frame.type === "release_session") released = true
          respond(
            frame,
            frame.type === "set_model"
              ? { provider: frame.provider, id: frame.modelId }
              : frame.type === "release_session"
                ? {
                    released: true,
                    session_path: sessionPath,
                    attachments: 0,
                    dropped: { deliveries: [], user_messages: [] },
                  }
                : frame.type === "interrupt"
                  ? { interrupted: true }
                  : {},
          )
        }
      })
    }),
  )
  try {
    const listening = once(server, "listening", { signal: AbortSignal.timeout(2000) })
    server.listen(transport.listenAddress)
    await listening
    await exercise({
      socket,
      root,
      recordPath,
      frames,
      mutations,
      permissionPreset: () => preset,
      drain: () => {
        draining = true
      },
      live: () => !ended,
      snapshotted: () => firstSnapshot.promise,
      subscribed: () => firstSubscribe.promise,
      publish: (records) => {
        for (const [client, mirror] of subscribers)
          for (const record of records) if (mirrored(mirror, record)) client.write(streamed(record))
      },
      dropSubscribers: () => {
        for (const client of subscribers.keys()) client.end()
      },
      push: (records) => {
        for (const client of attachedClients)
          for (const record of records) client.write(`${JSON.stringify({ ...record, sessionId: "rpc-1" })}\n`)
      },
    })
  } finally {
    const closed = once(server, "close", { signal: AbortSignal.timeout(2000) })
    for (const client of sockets) client.destroy()
    server.close()
    await closed
    rmSync(root, { recursive: true, force: true })
  }
}
