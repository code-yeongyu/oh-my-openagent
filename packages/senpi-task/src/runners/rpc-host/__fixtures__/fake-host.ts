import { mkdtempSync, rmSync } from "node:fs"
import { createServer, type Server, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { SenpiHostProtocolInfo } from "../../../lazy/senpi-barrel"
import { FakeSessionTable, type FakeDrainedSession, type FakeHostSession } from "./fake-host-sessions"
import { fakeProtocolInfo, probeFakeHost, type FakeHostIdentityOptions } from "./fake-host-probe"
import { fakeHostTransport, type FakeHostTransport } from "./fake-host-transport"
import { handleWireLine, writeFrame, type FakeHostCommand, type FakeHostOpenFailure } from "./fake-host-wire"

/**
 * In-process unix-socket JSONL daemon: enough of the senpi multi-session wire for a child session
 * client, a lifecycle probe and a two-parent integration suite. The wire lives in `fake-host-wire`
 * and the session rules in `fake-host-sessions`; THIS module owns the listener, the identity a
 * generation answers with, and the four things a machine-wide daemon does to its children - it
 * parks a session, holds a path while it drains, hands its socket to a newer generation, and dies.
 */

export type { FakeHostCommand, FakeHostOpenFailure } from "./fake-host-wire"
export type { FakeHostSession } from "./fake-host-sessions"

export interface FakeHostOptions extends FakeHostIdentityOptions {
  readonly openFailure?: FakeHostOpenFailure
  /** Refuse open_session for a path whose directory does not exist, as the real host does. */
  readonly enforceSessionDir?: boolean
  /** Write a real JSONL transcript per session path, as a daemon owning that file would. */
  readonly transcripts?: boolean
  /** What a draining generation tells a client to wait before retrying a held path. */
  readonly drainRetryAfterMs?: number
}

export interface FakeHost {
  readonly socketPath: string
  readonly commands: readonly FakeHostCommand[]
  readonly connections: number
  /** The identity this generation answers `get_protocol_info` with; it rotates on `handoff`. */
  readonly instanceId: string
  sessions(): readonly FakeHostSession[]
  /** How many connections ever held this session path at once - one JSONL writer reads as 1. */
  peakAttachments(sessionPath: string): number
  probeProtocolInfo(): Promise<SenpiHostProtocolInfo | undefined>
  failOpen(failure: FakeHostOpenFailure | undefined): void
  /** Record the named command but never answer it - the caller's request stays in flight. */
  withholdReply(type: string): void
  requestUi(routingId: string, request: Readonly<Record<string, unknown>>): void
  emitRecord(routingId: string, record: Readonly<Record<string, unknown>>): void
  /** The host loop stalled: a connection-level notice every attached client sees. */
  stall(driftMs: number): void
  /** Finish the turn in flight with an assistant answer, exactly as a real session would. */
  completeTurn(routingId: string, text: string): void
  evict(sessionPath: string): void
  closeSession(routingId: string, reason: string): void
  holdPath(sessionPath: string, ownerInstanceId: string): void
  releasePath(sessionPath: string): void
  /** A newer generation takes the socket: sessions park, their paths drain, the instance rotates. */
  handoff(nextInstanceId?: string): void
  /** Destroy every client connection while every session stays open on the host (a stall cut). */
  cutConnections(): void
  crash(): void
  restart(): Promise<void>
  waitForCommand(type: string): Promise<FakeHostCommand>
  /** Resolve when exactly `count` connections are open - a detach observed, never polled for. */
  waitForConnections(count: number): Promise<void>
  stop(): Promise<void>
}

export async function startFakeHost(options: FakeHostOptions = {}): Promise<FakeHost> {
  const dir = mkdtempSync(join(tmpdir(), "dh-fake-"))
  // The logical socket path on every platform; on win32 the transport derives the named pipe and
  // the secret from it, exactly as the engine's client does, so the same session logic runs there.
  const socketPath = join(dir, "rpc.sock")
  // Derived inside `listen` so a restart never re-binds the address its predecessor may still hold.
  // On win32 the pipe instance can outlive `server.close()` while a client handle lingers, so one
  // fixed derivation makes restart race itself with EADDRINUSE. Re-deriving also rotates
  // `<path>.secret`, which is how the real host behaves and how clients already resolve the address.
  let transport: FakeHostTransport
  const drainRetryAfterMs = options.drainRetryAfterMs ?? 2_000
  const table = new FakeSessionTable({ transcripts: options.transcripts === true })
  const commands: FakeHostCommand[] = []
  const waiters: Array<{ readonly type: string; readonly resolve: (command: FakeHostCommand) => void }> = []
  const sockets = new Set<Socket>()
  const connectionWaiters: Array<{ readonly count: number; readonly resolve: () => void }> = []
  const withheld = new Set<string>()
  let identity = fakeProtocolInfo(options)
  let generation = typeof identity.generation === "number" ? identity.generation : 1
  let openFailure = options.openFailure
  let server: Server

  const record = (command: FakeHostCommand): void => {
    commands.push(command)
    for (let index = waiters.length - 1; index >= 0; index--) {
      const waiter = waiters[index]
      if (waiter === undefined || waiter.type !== command.type) continue
      waiters.splice(index, 1)
      waiter.resolve(command)
    }
  }

  const ports = { table, identity: () => identity, openFailure: () => openFailure, enforceSessionDir: options.enforceSessionDir === true, withheld, record }

  const settleConnectionWaiters = (): void => {
    for (let index = connectionWaiters.length - 1; index >= 0; index--) {
      const waiter = connectionWaiters[index]
      if (waiter === undefined || waiter.count !== sockets.size) continue
      connectionWaiters.splice(index, 1)
      waiter.resolve()
    }
  }

  const listen = async (): Promise<void> => {
    transport = fakeHostTransport(socketPath)
    server = createServer((socket) => transport.authenticate(socket, () => {
      sockets.add(socket)
      settleConnectionWaiters()
      let buffer = ""
      socket.setEncoding("utf8")
      socket.on("data", (chunk: string) => {
        buffer += chunk
        for (;;) {
          const newline = buffer.indexOf("\n")
          if (newline === -1) break
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          if (line) handleWireLine(ports, socket, line)
        }
      })
      socket.on("error", () => undefined)
      socket.on("close", () => {
        sockets.delete(socket)
        table.detach(socket)
        settleConnectionWaiters()
      })
    }))
    await new Promise<void>((resolve) => server.listen(transport.listenAddress, resolve))
  }
  await listen()

  // The routing tag goes FIRST so a payload may carry a foreign `sessionId` on purpose - that is
  // how a suite proves a client drops records addressed to another session.
  const sendTo = (routingId: string, payload: Readonly<Record<string, unknown>>): void => {
    for (const socket of table.attachmentsOf(routingId)) writeFrame(socket, { sessionId: routingId, ...payload })
  }

  /** Tell a session that already left the live table: its former attachments are the audience. */
  const notifyDrained = (session: FakeDrainedSession, payload: Readonly<Record<string, unknown>>): void => {
    for (const socket of session.attachments) writeFrame(socket, { sessionId: session.routingId, ...payload })
  }

  const dropConnections = (): void => {
    for (const socket of [...sockets]) socket.destroy()
  }

  /** A drain closes its connections gracefully, so the records it just wrote still arrive. */
  const endConnections = (): void => {
    for (const socket of [...sockets]) socket.end()
  }

  const closeServer = (): Promise<void> =>
    new Promise<void>((resolve) => {
      server.close(() => resolve())
    })

  return {
    socketPath,
    commands,
    get connections() {
      return sockets.size
    },
    get instanceId() {
      return String(identity.instanceId)
    },
    sessions: () => table.view(),
    peakAttachments: (sessionPath) => table.peakAttachments(sessionPath),
    probeProtocolInfo: () => probeFakeHost(socketPath),
    failOpen: (failure) => {
      openFailure = failure
    },
    withholdReply: (type) => {
      withheld.add(type)
    },
    requestUi: (routingId, request) => sendTo(routingId, { type: "extension_ui_request", ...request }),
    emitRecord: (routingId, payload) => sendTo(routingId, payload),
    stall: (driftMs) => {
      for (const socket of [...sockets]) writeFrame(socket, { type: "host_stalled", driftMs })
    },
    completeTurn: (routingId, text) => {
      const message = { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" }
      table.appendTranscript(routingId, message)
      table.setStreaming(routingId, false)
      sendTo(routingId, { type: "message_end", message })
      sendTo(routingId, { type: "agent_end", willRetry: false, messages: [message] })
    },
    evict: (sessionPath) => {
      const parked = table.park(sessionPath)
      if (parked !== undefined) notifyDrained(parked, { type: "session_parked", sessionPath })
    },
    closeSession: (routingId, reason) => {
      const closed = table.close(routingId)
      if (closed !== undefined) notifyDrained(closed, { type: "session_closed", reason })
    },
    holdPath: (sessionPath, ownerInstanceId) => table.hold(sessionPath, ownerInstanceId, drainRetryAfterMs),
    releasePath: (sessionPath) => table.release(sessionPath),
    handoff: (nextInstanceId) => {
      const previous = String(identity.instanceId)
      generation += 1
      identity = fakeProtocolInfo({
        ...options,
        instanceId: nextInstanceId ?? `${previous}-gen${generation}`,
        generation,
      })
      for (const session of table.handoff(previous, drainRetryAfterMs)) {
        notifyDrained(session, { type: "session_closed", reason: "handoff_parked" })
      }
      endConnections()
    },
    cutConnections: () => dropConnections(),
    crash: () => {
      table.clear()
      dropConnections()
      server.close()
    },
    restart: async () => {
      table.clear()
      dropConnections()
      await closeServer()
      await listen()
    },
    waitForCommand: (type) =>
      new Promise<FakeHostCommand>((resolve) => {
        waiters.push({ type, resolve })
      }),
    waitForConnections: (count) =>
      sockets.size === count
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            connectionWaiters.push({ count, resolve })
          }),
    stop: async () => {
      dropConnections()
      await closeServer()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
