import { randomUUID } from "node:crypto"
import { createConnection, type Socket } from "node:net"
import { StringDecoder } from "node:string_decoder"
import {
  type AttachEnd,
  type CommandResult,
  LocalApiError,
  type RemoteAttach,
  type RemoteAttachEvent,
} from "@oh-my-opencode/device-service-core/device-service"
import {
  authenticateRpcHost,
  resolveRpcSocketTransport,
  type RpcObject,
} from "@oh-my-opencode/senpi-task/rpc-socket-client"
import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { resolveThreadSocket } from "../thread/live-surface-paths"
import type { JsonObject, SnapshotBody } from "./types"

// A session on THIS device, attached through its engine's operator endpoint (#13414 local watch). The device service
// cannot attach a device to itself (session.attach answers peer_not_found), so follow, wait and attach reach this
// device's own sessions here, as a device-service-shaped RemoteAttach: the same snapshot, records (with the engine's
// clientMessageId stamps), dialogs as frames, command and read. It opens a socket, so it stays out of omo remote's
// local-only graph (#13440): a caller outside it injects `createLocalAttach(...)` as RemoteClientDeps.localAttach.

export type LocalAttachOptions = {
  /** The operator endpoint; the thread client's own (`resolveThreadSocket`) by default. */
  readonly socket?: string
  /** Where the endpoint's key records live (`<keyRoot>/rpc/keys`); the agent dir by default, as the thread client. */
  readonly keyRoot?: string | (() => string)
  readonly connect?: (address: string) => Socket
}
export type LocalAttachTarget = { readonly device: string; readonly session: string; readonly durableId: string }

const REQUEST_TIMEOUT_MS = 30_000
const READ_TAIL = 50

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined)

// Every reply is a parsed JSON line, so it is a JsonObject; the RPC host auth reads it as its own RpcObject.
type Connection = { readonly request: (command: RpcObject) => Promise<JsonObject>; readonly close: () => void }

/** One connection to the endpoint: correlated requests; every other line goes to `onLine`, its close to `onClose`. */
async function connectEndpoint(
  endpoint: string,
  connect: (address: string) => Socket,
  onLine: (line: JsonObject) => void,
  onClose: () => void,
): Promise<Connection> {
  const transport = await resolveRpcSocketTransport(endpoint)
  if (transport === undefined) throw new LocalApiError("refused", `no operator endpoint answers at ${endpoint}`)
  const socket = connect(transport.address)
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve)
    socket.once("error", reject)
  })
  if (transport.secret !== undefined) socket.write(transport.secret)
  const pending = new Map<
    string,
    { readonly resolve: (reply: JsonObject) => void; readonly reject: (error: Error) => void }
  >()
  const decoder = new StringDecoder("utf8")
  let buffer = ""
  socket.on("data", (chunk: Buffer) => {
    buffer += decoder.write(chunk)
    for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
      const raw = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      let line: unknown
      try {
        line = JSON.parse(raw)
      } catch {
        continue
      }
      if (!isObject(line)) continue
      const id = line["id"]
      const waiting = line["type"] === "response" && typeof id === "string" ? pending.get(id) : undefined
      if (waiting !== undefined && typeof id === "string") {
        pending.delete(id)
        waiting.resolve(line)
      } else onLine(line)
    }
  })
  socket.on("error", () => socket.destroy())
  socket.once("close", () => {
    for (const waiting of pending.values()) waiting.reject(new LocalApiError("closed", "the operator endpoint closed"))
    pending.clear()
    onClose()
  })
  const request = (command: RpcObject): Promise<JsonObject> =>
    new Promise((resolve, reject) => {
      const id = randomUUID()
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new LocalApiError("request_timeout", `${String(command["type"])} got no answer`))
      }, REQUEST_TIMEOUT_MS)
      timer.unref?.()
      pending.set(id, {
        resolve: (reply) => {
          clearTimeout(timer)
          resolve(reply)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      socket.write(`${JSON.stringify({ ...command, id })}\n`)
    })
  return { request, close: () => socket.end() }
}

// The engine's refusals of the caller's own arguments (get-entries-command.js: an unknown `before` is not_found, a page
// size below one invalid_argument). The device service refuses a read's page invalid_request, so both answer alike.
const ARGUMENT_REFUSALS: ReadonlySet<string> = new Set(["not_found", "invalid_argument"])

/** A reply's data, or the engine's refusal as the local API error the client already maps. */
function dataOf(reply: JsonObject, what: string): JsonObject {
  if (reply["success"] === true) return isObject(reply["data"]) ? reply["data"] : {}
  const code = text(reply["errorCode"]) ?? text(reply["error"]) ?? "refused"
  const reason = `${what}: ${code}`
  if (code === "unknown_session" || code === "session_identity_mismatch")
    throw new LocalApiError("session_not_found", reason)
  throw new LocalApiError(ARGUMENT_REFUSALS.has(code) ? "invalid_request" : "unsupported", reason)
}

/** get_snapshot's answer (or an older engine's get_state) as the device service's snapshot body. */
function snapshotOf(data: JsonObject): SnapshotBody {
  const entries = Array.isArray(data["entries"]) ? data["entries"] : []
  const idOf = (entry: unknown): string | null => (isObject(entry) ? (text(entry["id"]) ?? null) : null)
  return {
    attach_id: 1,
    cursor: { marker_id: text(data["markerId"]) ?? "local", last_entry_id: idOf(entries.at(-1)) },
    state: isObject(data["state"]) ? data["state"] : data,
    entries,
    history_truncated: data["history_truncated"] === true,
    oldest_entry_id: idOf(entries[0]),
  }
}

/** Attaches to one session on this device through its engine's operator endpoint; see the file header. */
export function createLocalAttach(
  options: LocalAttachOptions = {},
): (target: LocalAttachTarget) => Promise<RemoteAttach> {
  const keyRoot =
    options.keyRoot ?? (() => process.env["SENPI_RPC_KEY_ROOT"]?.trim() || resolveAgentHome({ env: process.env }))
  return async (target) => {
    const endpoint = options.socket ?? resolveThreadSocket()
    const listeners = new Set<(event: RemoteAttachEvent) => void>()
    const frames = new Set<(frame: JsonObject) => void>()
    const history: RemoteAttachEvent[] = []
    const early: JsonObject[] = []
    const ended = Promise.withResolvers<AttachEnd>()
    let routing: string | undefined
    let snapshotted = false
    let end: AttachEnd | undefined
    let failure: unknown
    const finish = (reason: AttachEnd): void => {
      if (end !== undefined) return
      end = reason
      listeners.clear()
      ended.resolve(reason)
    }
    const deliver = (event: RemoteAttachEvent): void => {
      history.push(event)
      for (const listener of [...listeners]) {
        try {
          listener(event)
        } catch (error) {
          failure = error
          return finish("listener_failed")
        }
      }
    }
    const records = (lines: readonly JsonObject[]): void => {
      if (lines.length > 0) deliver({ kind: "records", attach_id: 1, records: lines })
    }
    // Only this session's lines: the host also broadcasts other sessions' lifecycle records on the connection.
    const onLine = (line: JsonObject): void => {
      if (end !== undefined || routing === undefined || line["sessionId"] !== routing) return
      const type = line["type"]
      // The engine takes its snapshot, then writes this marker, then the answer (get-snapshot.js): the records held
      // before it are already in the snapshot, so only the ones after it stream as new.
      if (type === "snapshot_marker") {
        if (!snapshotted) early.length = 0
        return
      }
      if (type === "session_closed") return finish("session_closed")
      if (type === "session_released") return finish("peer_detached")
      if (type === "extension_ui_request") {
        for (const listener of [...frames]) listener(line)
        return
      }
      const id = text(line["id"])
      const record: JsonObject =
        type === "question_resolved" && id !== undefined
          ? {
              type: "ui_request_settled",
              uiRequestId: id,
              disposition: line["outcome"] === "answered" ? "answered" : "cancelled",
            }
          : line
      if (snapshotted) records([record])
      else early.push(record)
    }
    const connection = await connectEndpoint(endpoint, options.connect ?? createConnection, onLine, () =>
      finish("closed"),
    )
    const snapshot = await (async () => {
      await authenticateRpcHost(connection.request, endpoint, keyRoot)
      const listed = dataOf(await connection.request({ type: "list_sessions" }), "list_sessions")["sessions"]
      const row = (Array.isArray(listed) ? listed : []).find(
        (session) => isObject(session) && session["durableSessionId"] === target.durableId,
      )
      routing = isObject(row) ? text(row["sessionId"]) : undefined
      if (routing === undefined)
        throw new LocalApiError("session_not_found", `no session ${target.durableId} on this device's engine`)
      dataOf(
        await connection.request({ type: "attach_session", sessionId: routing, durableSessionId: target.durableId }),
        "attach_session",
      )
      const reply = await connection.request({ type: "get_snapshot", sessionId: routing, observe: true })
      return snapshotOf(
        reply["success"] === true
          ? dataOf(reply, "get_snapshot")
          : dataOf(await connection.request({ type: "get_state", sessionId: routing }), "get_state"),
      )
    })().catch((error: unknown) => {
      connection.close()
      throw error
    })
    // The records written after the snapshot's marker (all of them on an engine without get_snapshot) follow it, in order.
    deliver({ kind: "snapshot", snapshot })
    snapshotted = true
    records(early.splice(0))
    const session = (): string => routing ?? target.session
    // Once the attach ended its socket is ended or gone, and close already failed what was pending: a request written
    // now would wait out REQUEST_TIMEOUT_MS. read and command refuse it alike. A session the engine ended (closed, or
    // released off this engine) is refused as the engine refuses a session it no longer has (unknown_session).
    const live = (): void => {
      if (end === "session_closed" || end === "peer_detached")
        throw new LocalApiError("session_not_found", `the engine ended session ${target.durableId} (${end})`)
      if (end !== undefined) throw new LocalApiError("closed", "the attach has ended")
    }
    return {
      device: target.device,
      sessionId: target.session,
      handle: `local:${session()}`,
      snapshot: Promise.resolve(snapshot),
      detached: ended.promise,
      onEvent: (listener) => {
        for (const event of history) listener(event)
        if (end === undefined) listeners.add(listener)
        return () => listeners.delete(listener)
      },
      // The engine pages the history itself (`{before, tail}`, newest first; an unknown `before` is refused), so a page
      // never carries the whole history.
      read: async (page = {}) => {
        live()
        const data = dataOf(
          await connection.request({
            type: "get_entries",
            sessionId: session(),
            tail: page.tail ?? READ_TAIL,
            ...(page.before === undefined ? {} : { before: page.before }),
          }),
          "get_entries",
        )
        const entries = (Array.isArray(data["entries"]) ? data["entries"] : []).filter(isObject)
        return {
          entries: entries.map((entry) => ({ entry_id: text(entry["id"]) ?? "", entry })),
          next_before: text(data["next_before"]) ?? null,
        }
      },
      command: async (rpc): Promise<CommandResult> => {
        live()
        const response = await connection.request({ ...rpc, sessionId: session() })
        return {
          outcome: {
            type: "event",
            kind: "session.command_state",
            command_id: randomUUID(),
            state: "engine_applied",
            retryable: false,
          },
          response,
        }
      },
      onFrame: (listener) => {
        frames.add(listener)
        return () => frames.delete(listener)
      },
      // A local connection has no delegated channel to lose: its end is `detached`.
      onChannelLoss: () => () => undefined,
      detach: async () => {
        if (end === undefined)
          await connection.request({ type: "release_attachment", sessionId: session() }).catch(() => undefined)
        connection.close()
        finish("detached")
      },
      failure: () => failure,
    }
  }
}
