import { once } from "node:events"
import { mkdtempSync, rmSync } from "node:fs"
import { createServer, type Socket } from "node:net"
import { join } from "node:path"

import { fakeHostTransport } from "../../../../../../senpi-task/src/runners/rpc-host/__fixtures__/fake-host-transport"
import { testBudgetSignal } from "../../../../../../../test-support/test-deadline"

type Frame = Readonly<Record<string, unknown>>
type Reply = Readonly<Record<string, unknown>>

/** What `get_state` and the open reply carry, as the engine answers them (closeprobe K1-K10, R1-R4). */
export type EngineSnapshot = {
  readonly lifecycle: {
    readonly state: string
    readonly waitingOn: {
      readonly children: number
      readonly background: readonly unknown[]
      readonly human: readonly { readonly kind: string }[]
    }
    readonly humanInputRevision?: number
  }
  readonly holds: readonly { readonly kind: string; readonly key?: string }[]
  readonly paused: boolean
  readonly isStreaming: boolean
  readonly pendingDialogs: readonly unknown[]
}

export const FINISHED: EngineSnapshot = {
  lifecycle: { state: "done", waitingOn: { children: 0, background: [], human: [] }, humanInputRevision: 0 },
  holds: [],
  paused: false,
  isStreaming: false,
  pendingDialogs: [],
}
export const STREAMING: EngineSnapshot = {
  ...FINISHED,
  lifecycle: { state: "running", waitingOn: { children: 0, background: [{ source: "delivery" }], human: [] } },
  isStreaming: true,
}
export const BACKGROUND: EngineSnapshot = {
  ...FINISHED,
  lifecycle: {
    state: "waiting_background",
    waitingOn: { children: 0, background: [{ source: "terminal-background-sessions", activeCount: 1 }], human: [] },
  },
}
export const PARKED_APPROVAL: EngineSnapshot = {
  ...FINISHED,
  lifecycle: {
    state: "waiting_human",
    waitingOn: { children: 0, background: [{ source: "delivery" }], human: [{ kind: "question" }] },
  },
  isStreaming: true,
  pendingDialogs: [{ method: "select", title: "Permission required: eval" }],
}
export const STALLED: EngineSnapshot = {
  ...FINISHED,
  lifecycle: { state: "waiting_human", waitingOn: { children: 0, background: [], human: [{ kind: "stalled" }] } },
}
export const STOPPED: EngineSnapshot = {
  ...FINISHED,
  lifecycle: { state: "paused", waitingOn: { children: 0, background: [], human: [] } },
  holds: [{ kind: "session_hold", key: "session_hold:1" }],
  paused: true,
}
export const HOST_STAMPED: EngineSnapshot = {
  ...FINISHED,
  lifecycle: { state: "held", waitingOn: { children: 0, background: [], human: [] } },
  holds: [{ kind: "unattended" }],
  paused: true,
}

export type FakeEngineSession = {
  snapshot: EngineSnapshot
  /** Attachments held by connections other than the carrier's (another client, or the host's own after a restart). */
  others: number
  /** Deliveries admitted into the session and held as notices; named in `dropped` by an interrupt release. */
  heldDeliveries: string[]
  readonly routingId: string
  released: boolean
}

export type FakeEngineHost = {
  readonly socketPath: string
  readonly frames: Frame[]
  readonly session: (path: string) => FakeEngineSession
  readonly setSnapshot: (path: string, snapshot: EngineSnapshot) => void
  readonly emitLifecycle: (path: string) => void
  readonly close: () => Promise<void>
}

export type FakeEngineOptions = {
  readonly capabilities?: readonly string[]
  /** Answers `release_session` as an unknown command (a host without the verb). */
  readonly releaseUnknown?: boolean
  readonly openRefusal?: (path: string) => Reply | undefined
}

/**
 * An engine host on a real socket that keeps per-session state across connections and answers the carrier's verbs
 * with the close probe's measured replies: a quiet release refused `turn_active` while a turn streams or a person is
 * asked, `busy: ["delivery"]` under a Stop with a held delivery, `attached` while another connection holds the session,
 * and `released: true` otherwise, even with background work (R4).
 */
export async function startFakeEngineHost(options: FakeEngineOptions = {}): Promise<FakeEngineHost> {
  const directory = mkdtempSync("/tmp/engine-host-")
  const socketPath = join(directory, "rpc.sock")
  const frames: Frame[] = []
  const sessions = new Map<string, FakeEngineSession>()
  const byRouting = new Map<string, string>()
  const holders = new Map<Socket, Set<string>>()
  const sockets = new Set<Socket>()
  let nextRouting = 1
  const transport = fakeHostTransport(socketPath)

  const session = (path: string): FakeEngineSession => {
    let found = sessions.get(path)
    if (found === undefined) {
      found = { snapshot: FINISHED, others: 0, heldDeliveries: [], routingId: `rpc-${nextRouting++}`, released: false }
      sessions.set(path, found)
      byRouting.set(found.routingId, path)
    }
    return found
  }
  const attachmentsOf = (path: string): number =>
    [...holders.values()].filter((held) => held.has(path)).length + session(path).others
  const pathOf = (frame: Frame): string | undefined => byRouting.get(String(frame.sessionId))
  const refuse = (code: string, errorData?: Reply): Reply => ({
    success: false,
    error: code,
    errorCode: code,
    ...(errorData === undefined ? {} : { errorData }),
  })

  const answer = (socket: Socket, frame: Frame): Reply => {
    const held = holders.get(socket) ?? new Set<string>()
    holders.set(socket, held)
    switch (frame.type) {
      case "get_protocol_info":
        return { success: true, data: { capabilities: options.capabilities ?? ["detach_connection", "release_attachment"] } }
      case "open_session": {
        const path = String(frame.sessionPath)
        const refusal = options.openRefusal?.(path)
        if (refusal !== undefined) return refusal
        const entry = session(path)
        const attached = attachmentsOf(path) > 0
        entry.released = false
        held.add(path)
        return { success: true, data: { sessionId: entry.routingId, attached, state: entry.snapshot } }
      }
      case "get_state": {
        const path = pathOf(frame)
        return path === undefined ? refuse("unknown_session") : { success: true, data: session(path).snapshot }
      }
      case "list_sessions":
        return {
          success: true,
          data: {
            sessions: [...sessions.entries()]
              .filter(([, entry]) => !entry.released)
              .map(([path, entry]) => ({
                sessionId: entry.routingId,
                sessionPath: path,
                status: "open",
                attachments: attachmentsOf(path),
              })),
          },
        }
      case "wake":
        return pathOf(frame) === undefined ? refuse("unknown_session") : { success: true, data: { admitted: [] } }
      case "release_session": {
        const path = pathOf(frame)
        if (path === undefined) return refuse("unknown_session")
        if (options.releaseUnknown === true) return refuse("unknown_command")
        const entry = session(path)
        if (entry.others > 0) return refuse("attached", { attachments: entry.others })
        const interrupt = frame.interrupt === true
        const { snapshot } = entry
        const asking = snapshot.pendingDialogs.length > 0 || snapshot.lifecycle.state === "running"
        if (asking) return refuse("turn_active", { attachments: 1, busy: ["turn", "session_work"] })
        if (entry.heldDeliveries.length > 0 && !interrupt)
          return refuse("turn_active", { attachments: 1, busy: ["delivery"] })
        const dropped = interrupt ? entry.heldDeliveries : []
        entry.heldDeliveries = []
        entry.released = true
        held.delete(path)
        return {
          success: true,
          data: { released: true, attachments: 1, dropped: { deliveries: dropped, user_messages: [] } },
        }
      }
      case "close_session": {
        const path = pathOf(frame)
        if (path === undefined) return refuse("unknown_session")
        held.delete(path)
        const entry = session(path)
        if (entry.others === 0) {
          entry.released = true
          entry.snapshot = STALLED
        }
        return { success: true, data: {} }
      }
      case "release_attachment": {
        const path = pathOf(frame)
        if (path !== undefined) held.delete(path)
        return { success: true, data: {} }
      }
      case "detach_connection":
        held.clear()
        return { success: true, data: { deferred: [] } }
      default:
        return refuse("unknown_command")
    }
  }

  const server = createServer((socket) =>
    transport.authenticate(socket, () => {
      sockets.add(socket)
      socket.once("close", () => {
        sockets.delete(socket)
        holders.delete(socket)
      })
      let buffer = ""
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8")
        for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
          const frame = JSON.parse(buffer.slice(0, newline)) as Frame
          buffer = buffer.slice(newline + 1)
          if (frame.type !== "get_protocol_info") frames.push(frame)
          const reply = answer(socket, frame)
          socket.write(`${JSON.stringify({ id: frame.id, type: "response", command: frame.type, ...reply })}\n`)
        }
      })
    }),
  )
  const listening = once(server, "listening", { signal: testBudgetSignal("fake engine host to emit 'listening'") })
  server.listen(transport.listenAddress)
  await listening
  return {
    socketPath,
    frames,
    session,
    setSnapshot: (path, snapshot) => {
      session(path).snapshot = snapshot
    },
    emitLifecycle: (path) => {
      const entry = session(path)
      const line = `${JSON.stringify({ type: "session_lifecycle", sessionId: entry.routingId, lifecycle: entry.snapshot.lifecycle })}\n`
      for (const [socket, held] of holders) if (held.has(path)) socket.write(line)
    },
    close: async () => {
      const closed = once(server, "close", { signal: AbortSignal.timeout(2000) })
      for (const socket of sockets) socket.destroy()
      server.close()
      await closed
      rmSync(directory, { recursive: true, force: true })
    },
  }
}
