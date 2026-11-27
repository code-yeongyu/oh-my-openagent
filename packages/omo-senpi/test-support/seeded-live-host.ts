import { createHmac, randomBytes } from "node:crypto"
import { once } from "node:events"
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { createConnection, createServer, type Socket } from "node:net"
import { join } from "node:path"

import { createLiveThreadSurface, type LiveThreadSurface } from "../src/components/thread/live-surface"
import { shortTempDir } from "./short-tmp"

// One live thread served by the REAL live surface over a scripted rpc_host endpoint in a scratch directory, shared by
// the root's non-disclosure scan and the thread component's session scan. The dial material sits where the surface
// reads it: the rpc key record under the scratch key root (its content and its path are canaries). A fault kind makes
// the endpoint or the key record fail the way a real one can, so the surface's own failure texts are scanned too.

export const SEEDED_THREAD = "t-seeded-1"
const ROUTING = "rpc-1"
const LAUNCH_ID = "0b1d0c2e-1f3a-4b5c-8d6e-7f8091a2b3c4"

export type SeededFault =
  | "none"
  | "key_absent"
  | "key_mode_wrong"
  | "key_record_invalid"
  | "key_short"
  | "auth_refused"
  | "closes_mid_handshake"
  /** A live key record names the endpoint, and the endpoint answers get_protocol_info without an auth block. */
  | "no_challenge_with_record"
  /** No key record at all, and the endpoint answers without an auth block: a host from before key records. */
  | "no_challenge_no_record"

export type SeededCanaries = {
  /** 64 hex characters: the rpc key record's key, which must reach no answer. */
  readonly keyHex: string
  /** A name segment of the key root directory: the key record's path carries it. */
  readonly keyPathSegment: string
  /** A name segment of the socket's directory: the socket path carries it. */
  readonly socketPathSegment: string
  /** The thread's working folder segment and title, as the HOST row names them (positive controls). */
  readonly row: { readonly cwdSegment: string; readonly name: string }
  /** The transcript text a read carries. */
  readonly message: string
}

export type SeededLiveHost = {
  readonly host: LiveThreadSurface
  readonly socket: string
  readonly keyRecord: string
  readonly cwd: string
  /** Every frame type the endpoint received, in order, across connections. */
  readonly received: readonly string[]
  readonly close: () => Promise<void>
}

type Frame = Readonly<Record<string, unknown>>

const hmac = (key: Buffer, parts: readonly string[]) =>
  createHmac("sha256", key).update(parts.join("\n"), "utf8").digest("hex")

export async function seededLiveHost(canaries: SeededCanaries, fault: SeededFault = "none"): Promise<SeededLiveHost> {
  const root = shortTempDir("sl-")
  const socketDir = join(root, canaries.socketPathSegment)
  const keyRoot = join(root, canaries.keyPathSegment)
  const cwd = join(root, canaries.row.cwdSegment)
  for (const dir of [socketDir, cwd, join(keyRoot, "rpc")]) mkdirSync(dir, { recursive: true })
  mkdirSync(join(keyRoot, "rpc", "keys"), { mode: 0o700 })
  chmodSync(join(keyRoot, "rpc", "keys"), 0o700)
  const keyRecord = join(keyRoot, "rpc", "keys", LAUNCH_ID)
  const key = Buffer.from(canaries.keyHex, "hex")
  const socket = join(socketDir, "h.sock")
  const challenges = fault !== "no_challenge_with_record" && fault !== "no_challenge_no_record"
  if (fault !== "key_absent" && fault !== "no_challenge_no_record") {
    const body =
      fault === "key_record_invalid"
        ? `{"version":1,"key":"${canaries.keyHex}"`
        : fault === "key_short"
          ? JSON.stringify({ version: 1, launch_id: LAUNCH_ID, key: canaries.keyHex.slice(0, 40) })
          : JSON.stringify({
              version: 1,
              launch_id: LAUNCH_ID,
              key: canaries.keyHex,
              pid: process.pid,
              endpoint: socket,
            })
    writeFileSync(keyRecord, body, { mode: 0o600 })
    chmodSync(keyRecord, fault === "key_mode_wrong" ? 0o644 : 0o600)
  }
  const session = { sessionId: ROUTING, durableSessionId: SEEDED_THREAD, cwd, name: canaries.row.name, status: "open" }
  const answer = (frame: Frame, serverNonce: string): Readonly<Record<string, unknown>> => {
    switch (frame["type"]) {
      case "get_protocol_info": {
        if (!challenges) return { data: {} }
        const clientNonce = String(Reflect.get(Object(frame["auth"]), "client_nonce") ?? "")
        const proof = hmac(key, ["senpi-rpc-server", LAUNCH_ID, clientNonce, serverNonce])
        return { data: { auth: { launch_id: LAUNCH_ID, server_nonce: serverNonce, server_proof: proof } } }
      }
      case "authenticate":
        return fault === "auth_refused" ? { success: false, error: "auth_failed" } : { data: {} }
      case "list_sessions":
        return { data: { sessions: [session] } }
      case "get_state":
        return { data: { isStreaming: false } }
      case "get_messages":
        return { data: { messages: [{ role: "user", content: canaries.message }] } }
      case "prompt":
        return { data: { turnId: "turn-1" } }
      case "interrupt":
        return { data: { interrupted: true, turnId: "turn-1" } }
      case "set_model":
        return { data: { provider: frame["provider"], id: frame["modelId"] } }
      case "get_available_models":
        return { data: { models: [{ provider: "anthropic", id: "claude" }] } }
      default:
        return { data: {} }
    }
  }
  const sockets = new Set<Socket>()
  const received: string[] = []
  const server = createServer((connection) => {
    sockets.add(connection)
    connection.once("close", () => sockets.delete(connection))
    const serverNonce = randomBytes(32).toString("hex")
    let buffer = ""
    connection.on("data", (chunk) => {
      buffer += chunk.toString("utf8")
      for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
        const frame = JSON.parse(buffer.slice(0, newline)) as Frame
        buffer = buffer.slice(newline + 1)
        received.push(String(frame["type"]))
        if (fault === "closes_mid_handshake" && frame["type"] === "authenticate") {
          connection.destroy()
          return
        }
        const reply = answer(frame, serverNonce)
        connection.write(
          `${JSON.stringify({ id: frame["id"], type: "response", command: frame["type"], success: true, ...reply })}\n`,
        )
      }
    })
  })
  const listening = once(server, "listening")
  server.listen(socket)
  await listening
  const host = createLiveThreadSurface(undefined, {
    env: { SENPI_RPC_SOCKET: socket, HOME: root },
    keyRoot,
    registry: async () => [],
    statusAll: async () => [{ socket, reachable: true, session_paths: [] }],
    connect: (path) => createConnection(path),
  })
  return {
    host,
    socket,
    keyRecord,
    cwd,
    received,
    close: async () => {
      const closed = once(server, "close")
      for (const open of sockets) open.destroy()
      server.close()
      await closed
      rmSync(root, { recursive: true, force: true })
    },
  }
}
