// The fake relay of the X1a proof world: device A's device service and the relay as one test double, answering the
// local API on A's service state directory (OMO_DEVICE_SERVICE_STATE_DIR) with the vendored owner's handshake, proof,
// framing and validation (device-service-core's conformance owner), and forwarding every engine record addressed to
// device B to B's REAL engine host through an EnginePort. What it fakes: the account (two devices, signed in), the
// relay's routing, and the listing round. What it does not fake: the record B's engine receives and the reply it gives.
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  chunkPayload,
  LOCAL_INLINE_MAX,
  lineBytes,
  sha256Hex,
} from "../../../../packages/device-service-core/src/local-api/chunking.ts"
import { pageListing } from "../../../../packages/device-service-core/src/local-api/listing.ts"
import type {
  JsonObject,
  ListingRow,
  LocalRequest,
  SessionCommand,
} from "../../../../packages/device-service-core/src/local-api/protocol.ts"
import { startFakeOwner } from "../../../../packages/device-service-core/test/local-api/conformance/fake-owner.ts"
import {
  type Conn,
  eventOf,
  ok,
  type Outcome,
  type OwnerState,
  refuse,
  utf8,
} from "../../../../packages/device-service-core/test/local-api/conformance/fake-owner-state.ts"
import type { World } from "../../../../packages/device-service-core/test/local-api/conformance/world.ts"
import { createKeyBook } from "./relay-keys.ts"

export type Device = { readonly id: string; readonly name: string }
export type EngineSession = {
  readonly key: string
  readonly engineId: string
  readonly name: string
  readonly cwd: string
  readonly state: "running" | "idle" | "ended"
}
/** Device B's engine host as the relay reaches it: one record in, the engine's own reply out, and its unasked frames. */
export type EnginePort = {
  readonly endpoint: string
  readonly request: (record: JsonObject) => Promise<JsonObject>
  readonly onFrame: (listener: (frame: JsonObject) => void) => () => void
  readonly sessions: () => Promise<readonly EngineSession[]>
  readonly close: () => Promise<void>
}
export type FakeRelay = {
  readonly stateDir: string
  /** Every request type a surface sent, in order: what today's code asks of the device service. */
  readonly requests: readonly string[]
  readonly stop: () => Promise<void>
}

const SINCE_MS = 1_790_000_000_000

const worldFor = (here: Device, peer: Device): World => ({
  service_version: "1.4.0",
  status: { state: "connected", since_ms: SINCE_MS, device: here, origin_configured: true, enabled: true },
  devices: [here, peer].map((device) => ({
    device: device.id,
    label: device.name,
    kind: "cli",
    platform: "linux",
    last_seen_ms: SINCE_MS,
    online: true,
  })),
  listing: { revisions: [], devices: {} },
  sessions: [],
})

const rowOf = (device: string, key: string, session: EngineSession): ListingRow => ({
  device,
  session_id: key,
  title: session.name,
  project: session.cwd.split("/").at(-1) ?? "",
  path: session.cwd,
  state: session.state,
  updated_ms: SINCE_MS,
  source: "live",
  as_of: SINCE_MS,
  durable_id: session.engineId,
})

// A command event inline, or as a blob of its UTF-8 JSON when the line would pass LOCAL_INLINE_MAX (protocol-delegated).
const sendCommandEvent = (conn: Conn, mint: () => string, device: string, body: JsonObject): void => {
  const inline = eventOf("session.command_event", { device, ...body })
  if (lineBytes(inline) <= LOCAL_INLINE_MAX) return conn.send(inline)
  const bytes = utf8(JSON.stringify(body))
  const id = mint()
  conn.send(eventOf("session.command_event", { device, blob: { id, bytes: bytes.length, sha256: sha256Hex(bytes) } }))
  for (const { off, b } of chunkPayload(bytes)) conn.send(eventOf("session.command_blob_chunk", { id, off, b }))
  conn.send(eventOf("session.command_blob_done", { id }))
}

const targetOf = (request: LocalRequest): Record<string, unknown> => {
  const fields = ["device", "endpoint", "session", "attach", "session_id", "engine_id", "locate"] as const
  return Object.fromEntries(fields.filter((name) => name in request).map((name) => [name, Reflect.get(request, name)]))
}

const objectOf = (value: unknown): JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : {}

const rpcOf = (state: OwnerState, request: SessionCommand): JsonObject | undefined => {
  if ("rpc" in request) return request.rpc
  const taken = state.uploads.take(request.upload_id)
  if (taken.kind !== "text") return undefined
  const parsed: unknown = JSON.parse(taken.text)
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as JsonObject) : undefined
}

export async function startFakeRelay(options: {
  readonly here: Device
  readonly peer: Device
  readonly engine: EnginePort
  readonly stateDir?: string
  /** Called with each request a surface sent (its type and the fields that name its target), as it arrives. */
  readonly trace?: (line: string) => void
}): Promise<FakeRelay> {
  const { here, peer, engine } = options
  const stateDir = options.stateDir ?? mkdtempSync(join(tmpdir(), "x1a-ds-"))
  chmodSync(stateDir, 0o700)
  const requests: string[] = []
  const framed = new Set<Conn>()
  const attaches = new Map<string, string>()
  const book = createKeyBook()
  const unframe = engine.onFrame((frame) => {
    for (const conn of framed) conn.send(eventOf("session.command_event", { device: peer.id, frame }))
  })

  const forward = (state: OwnerState, conn: Conn, commandId: string, rpc: JsonObject, locate: boolean): void => {
    framed.add(conn)
    void engine.request({ ...rpc, id: commandId }).then(
      (response) => {
        const data = objectOf(response["data"])
        const opened = data["sessionId"]
        const engineState = objectOf(data["state"])
        const durable = engineState["durableSessionId"] ?? engineState["sessionId"]
        const key =
          typeof opened === "string" ? book.learn(opened, typeof durable === "string" ? durable : undefined) : undefined
        const body: JsonObject =
          locate && rpc["type"] === "open_session" && key !== undefined
            ? { command_id: commandId, response, located: { key, session: `${peer.id}.${key}` } }
            : { command_id: commandId, response }
        sendCommandEvent(conn, state.mint, peer.id, body)
        conn.send(
          eventOf("session.command_state", { command_id: commandId, state: "engine_applied", retryable: false }),
        )
      },
      (error: unknown) =>
        conn.send(
          eventOf("session.command_state", {
            command_id: commandId,
            state: "uncertain",
            reason: "transport_lost",
            retryable: false,
            receipt: { detail: String(error).slice(0, 200) },
          }),
        ),
    )
  }

  const command = (state: OwnerState, conn: Conn, request: SessionCommand): Outcome => {
    const rpc = rpcOf(state, request)
    if (rpc === undefined) return refuse("upload_incomplete", "the upload is not complete")
    const commandId = request.command_id ?? state.mint()
    if ("device" in request) {
      if (request.device !== peer.id || request.endpoint !== engine.endpoint)
        return refuse("unsupported", "the fake relay serves only device B's engine endpoint")
      return ok({ command_id: commandId }, () => forward(state, conn, commandId, rpc, request.locate === true))
    }
    const key =
      "session" in request
        ? request.session.startsWith(`${peer.id}.`)
          ? request.session.slice(peer.id.length + 1)
          : undefined
        : "attach" in request
          ? attaches.get(request.attach)
          : undefined
    if (key === undefined)
      return refuse("unsupported", "the fake relay serves session, attach and endpoint targets on device B")
    const routing = book.routingOf(key)
    if (routing === undefined) return refuse("session_not_found", "device B lists no session under that key")
    const addressed = rpc["sessionId"] === undefined || rpc["sessionId"] === key ? { ...rpc, sessionId: routing } : rpc
    return ok({ command_id: commandId, device: peer.id, key, session: `${peer.id}.${key}` }, () =>
      forward(state, conn, commandId, addressed, false),
    )
  }

  const list = (state: OwnerState, conn: Conn): Outcome => {
    const queryId = state.mint()
    return ok({ query_id: queryId }, () => {
      conn.send(eventOf("sessions.round", { query_id: queryId, state: "open", devices: { [peer.id]: "pending" } }))
      void engine.sessions().then((sessions) => {
        const rows = sessions.map((session) => rowOf(peer.id, book.learn(session.key, session.engineId), session))
        for (const event of pageListing(rows, LOCAL_INLINE_MAX, { query_id: queryId, revision: 1, incomplete: [] }))
          conn.send(event)
        conn.send(eventOf("sessions.round", { query_id: queryId, state: "done", devices: { [peer.id]: "answered" } }))
      })
    })
  }

  const intercept = (state: OwnerState, conn: Conn, request: LocalRequest): Outcome | undefined => {
    requests.push(request.type)
    options.trace?.(
      JSON.stringify({
        type: request.type,
        ...("rpc" in request ? { rpc: request.rpc["type"] } : {}),
        ...targetOf(request),
      }),
    )
    switch (request.type) {
      case "sessions.list":
        return list(state, conn)
      case "session.endpoints":
        if (request.device !== peer.id) return refuse("unsupported", "the fake relay lists device B's endpoints only")
        return ok({ endpoints: [engine.endpoint], ...(request.primary === true ? { primary: engine.endpoint } : {}) })
      case "session.command":
        return command(state, conn, request)
      case "session.locate": {
        const key = request.device === peer.id ? book.locate(request.engine_id) : undefined
        if (key === undefined) return refuse("session_not_found", "device B reported no such engine session")
        return ok({ device: peer.id, key, session: `${peer.id}.${key}` })
      }
      case "session.attach": {
        if (request.device !== peer.id) return refuse("peer_not_found", "no such device in the account")
        const attach = state.mint()
        attaches.set(attach, request.session_id)
        return ok({ attach })
      }
      default:
        return undefined
    }
  }

  const owner = await startFakeOwner({ stateDir, world: worldFor(here, peer), intercept })
  return {
    stateDir,
    requests,
    stop: async () => {
      unframe()
      await owner.stop()
      await engine.close()
      if (options.stateDir === undefined) rmSync(stateDir, { recursive: true, force: true })
    },
  }
}
