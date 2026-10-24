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
}
export type ContractHost = {
  readonly socket: string
  readonly root: string
  readonly recordPath: string
  readonly frames: { readonly connection: number; readonly frame: Frame }[]
  readonly mutations: Frame[]
  readonly permissionPreset: () => string
}

/** Enforces the public v1.1 wire contract, including connection-local attachment ownership. */
export async function withContractHost(options: ContractHostOptions, exercise: (host: ContractHost) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "rpc-client-"))
  const socket = join(root, "rpc.sock")
  const transport = fakeHostTransport(socket)
  const launchId = randomUUID()
  const key = randomBytes(32)
  const keyRoot = options.keyRoot ?? root
  const recordPath = join(keyRoot, "rpc", "keys", launchId)
  mkdirSync(join(keyRoot, "rpc", "keys"), { recursive: true, mode: 0o700 })
  for (const directory of [keyRoot, join(keyRoot, "rpc")]) chmodSync(directory, 0o700)
  writeFileSync(recordPath, JSON.stringify({
    version: 1, launch_id: launchId, key: key.toString("hex"), pid: process.pid,
    process_start: null, endpoint: socket, created_at: new Date().toISOString(),
  }), { mode: 0o600 })
  options.prepareRecord?.(recordPath, root)
  const frames: ContractHost["frames"] = []
  const mutations: Frame[] = []
  const sockets = new Set<Socket>()
  let nextConnection = 0
  let preset = "read-only"
  const durableId = options.durableId ?? "dur-selected"
  const sessionPath = join(root, "session.jsonl")
  const session = () => ({ sessionId: "rpc-1", durableSessionId: durableId, sessionPath, cwd: root, name: "target" })
  // Host-wide, unlike attachments: a session that left the host is unknown to every later connection.
  let gone = options.attachRefusal === "unknown_session"
  const server = createServer((client) => transport.authenticate(client, () => {
    const connection = nextConnection++
    sockets.add(client)
    client.once("close", () => sockets.delete(client))
    let buffer = ""
    let authenticated = process.platform === "win32" || options.auth !== true
    let attached = false
    let expectedProof = ""
    let released = false
    const respond = (frame: Frame, data: unknown = {}, error?: string, errorData?: Frame) => client.write(`${options.strayLine ? "not json\n" : ""}${JSON.stringify({
      id: frame.id, type: "response", command: frame.type, success: error === undefined,
      ...(error === undefined ? { data } : { error, errorCode: error, ...(errorData === undefined ? {} : { errorData }) }),
    })}\n`)
    // Wire frames 4 and 5: an auth refusal is answered, then the host closes the connection.
    const refuseAndClose = (frame: Frame, error: "auth_required" | "auth_failed") => { respond(frame, undefined, error); client.end() }
    client.setEncoding("utf8")
    client.on("data", (chunk: string) => {
      buffer += chunk
      for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
        const frame = JSON.parse(buffer.slice(0, newline)) as Frame
        buffer = buffer.slice(newline + 1)
        frames.push({ connection, frame })
        if (options.silent?.includes(String(frame.type))) continue
        if (frame.type === "get_protocol_info" && options.refuseProtocolInfo) { respond(frame, undefined, "unknown_command"); continue }
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
            const answer = { capabilities: [...capabilities, "socket_auth"], auth: {
              launch_id: launchId, server_nonce: serverNonce,
              server_proof: options.badProof ? "0".repeat(64) : proof("senpi-rpc-server", clientNonce, serverNonce),
            } }
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
        if (!authenticated) { refuseAndClose(frame, "auth_required"); continue }
        if (frame.type === "attach_session") {
          if (options.attachRefusal === "host_draining") respond(frame, undefined, "session_busy_lifecycle", { reason: "host_draining" })
          else if (options.attachRefusal === "session_not_attached") respond(frame, undefined, "session_not_attached", { reason: "no_connection" })
          else if (gone) respond(frame, undefined, "unknown_session")
          else if (frame.sessionId !== "rpc-1" || frame.durableSessionId !== durableId) {
            respond(frame, undefined, "session_identity_mismatch")
          } else { attached = true; respond(frame, { sessionId: "rpc-1", attached: true }) }
          continue
        }
        if (frame.type === "release_attachment") {
          if (options.afterMutation === "connection_lost") { client.destroy(); continue }
          if (released && options.releasedAttachmentAnswer === "unknown_session") respond(frame, undefined, "unknown_session")
          else if (attached && !released) respond(frame, { deferred: false })
          else respond(frame, undefined, "session_not_attached", { reason: "not_attached" })
          attached = false
          continue
        }
        if (frame.type === "reclaim_session") {
          if (options.attachRefusal === "host_draining") respond(frame, undefined, "session_busy_lifecycle", { reason: "host_draining" })
          else if (options.attachRefusal === "session_not_attached") respond(frame, undefined, "session_not_attached", { reason: "no_connection" })
          else if (frame.durableSessionId !== durableId) respond(frame, undefined, "session_identity_mismatch")
          else { attached = true; respond(frame, { reclaimed: true, sessionId: "rpc-1" }) }
          continue
        }
        if (frame.type === "list_sessions") { respond(frame, { sessions: [session()] }); continue }
        if (frame.type === "get_messages") { respond(frame, { messages: [] }); continue }
        if (frame.type === "get_state") { respond(frame, { isStreaming: false }); continue }
        if (frame.type === "get_available_models") { respond(frame, { models: [{ provider: "p", id: "m" }] }); continue }
        if (frame.type === "warm") { respond(frame, { warmed: true }); continue }
        if (frame.type === "open_session") {
          attached = true
          if (typeof frame.permissionPreset === "string") preset = frame.permissionPreset
          respond(frame, { sessionId: "rpc-1", state: session() })
          continue
        }
        // Only session-scoped commands are gated, as the host's attachment gate reads `sessionId`.
        if (!options.legacy && !attached && frame.sessionId !== undefined) {
          respond(frame, undefined, "session_not_attached", {
            reason: "this connection is not attached to that session",
            action: "attach first with attach_session { sessionId, durableSessionId } or open_session { sessionPath }",
          })
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
        respond(frame, frame.type === "set_model" ? { provider: frame.provider, id: frame.modelId }
          : frame.type === "release_session" ? { released: true, session_path: sessionPath, attachments: 0, dropped: { deliveries: [], user_messages: [] } }
          : frame.type === "interrupt" ? { interrupted: true } : {})
      }
    })
  }))
  try {
    const listening = once(server, "listening", { signal: AbortSignal.timeout(2000) })
    server.listen(transport.listenAddress)
    await listening
    await exercise({ socket, root, recordPath, frames, mutations, permissionPreset: () => preset })
  } finally {
    const closed = once(server, "close", { signal: AbortSignal.timeout(2000) })
    for (const client of sockets) client.destroy()
    server.close()
    await closed
    rmSync(root, { recursive: true, force: true })
  }
}
