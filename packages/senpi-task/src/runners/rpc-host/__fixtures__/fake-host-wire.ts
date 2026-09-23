import { existsSync } from "node:fs"
import { dirname, isAbsolute } from "node:path"
import type { Socket } from "node:net"

import type { FakeSessionTable } from "./fake-host-sessions"

/**
 * The fake daemon's wire half: one JSONL line in, one response (or nothing, when a suite withholds
 * the reply) out. Every command the child session client, the close writer and the lifecycle probe
 * issue is answered here in the engine's own response envelope.
 */

export interface FakeHostCommand {
  readonly type: string
  readonly sessionId: string | undefined
  readonly payload: Readonly<Record<string, unknown>>
}

/** How the host refuses an `open_session` - `session_path_in_use`, `invalid_launch_profile`, ... */
export interface FakeHostOpenFailure {
  readonly code: string
  readonly detail?: string
  readonly data?: unknown
}

export interface FakeHostWirePorts {
  readonly table: FakeSessionTable
  /** Read per line so a handoff's rotated instance answers the very next probe. */
  readonly identity: () => Readonly<Record<string, unknown>>
  readonly openFailure: () => FakeHostOpenFailure | undefined
  /** Mirror the engine: opening at a path whose directory does not exist fails with ENOENT. */
  readonly enforceSessionDir: boolean
  readonly withheld: ReadonlySet<string>
  readonly record: (command: FakeHostCommand) => void
}

export function writeFrame(socket: Socket, payload: unknown): void {
  socket.write(`${JSON.stringify(payload)}\n`)
}

export function handleWireLine(ports: FakeHostWirePorts, socket: Socket, line: string): void {
  const parsed: unknown = JSON.parse(line)
  if (typeof parsed !== "object" || parsed === null) return
  const payload: Readonly<Record<string, unknown>> = { ...parsed }
  const type = typeof payload.type === "string" ? payload.type : "unknown"
  const routingId = typeof payload.sessionId === "string" ? payload.sessionId : undefined
  ports.record({ type, sessionId: routingId, payload })
  if (ports.withheld.has(type)) return
  const ok = (data: unknown): void =>
    writeFrame(socket, { type: "response", id: payload.id, command: type, success: true, data })
  switch (type) {
    case "get_protocol_info":
      return ok(ports.identity())
    case "open_session":
      return openSession(ports, socket, payload)
    case "list_sessions":
      return ok({ sessions: ports.table.rows(payload.include_workers === true) })
    case "close_session": {
      ports.table.close(routingId ?? "")
      ok({})
      return writeFrame(socket, { type: "session_closed", sessionId: routingId, reason: "client_close" })
    }
    case "prompt":
      if (routingId !== undefined && typeof payload.message === "string") {
        ports.table.appendTranscript(routingId, { role: "user", content: payload.message })
        ports.table.setStreaming(routingId, true)
      }
      return ok({})
    case "get_state":
      return ok({
        sessionId: `durable-${payload.sessionId}`,
        isStreaming: routingId !== undefined && ports.table.isStreaming(routingId),
      })
    case "get_entries":
      return ok({ entries: [], leafId: null })
    case "switch_session":
      return ok({ cancelled: false })
    case "extension_ui_response":
    case "extension_ui_progress":
      return
    default:
      return ok({})
  }
}

function openSession(ports: FakeHostWirePorts, socket: Socket, payload: Readonly<Record<string, unknown>>): void {
  const configured = ports.openFailure()
  if (configured !== undefined) return refuse(socket, payload, configured)
  const sessionPath = typeof payload.sessionPath === "string" ? payload.sessionPath : "unnamed-session"
  if (ports.enforceSessionDir && isAbsolute(sessionPath) && !existsSync(dirname(sessionPath))) {
    // The real host lstat()s the session directory before it opens the JSONL; the client owns that
    // directory, so a path nobody created is refused exactly as the engine refuses it.
    return refuse(socket, payload, {
      code: "open_failed",
      detail: `ENOENT: no such file or directory, lstat '${dirname(sessionPath)}'`,
    })
  }
  const opened = ports.table.open(socket, sessionPath, payload)
  if (opened.kind === "held") {
    return refuse(socket, payload, {
      code: "session_path_in_use",
      detail: `held by ${opened.hold.owner}`,
      data: { owner: opened.hold.owner, retry_after_ms: opened.hold.retryAfterMs },
    })
  }
  writeFrame(socket, {
    type: "response",
    id: payload.id,
    command: "open_session",
    success: true,
    sessionId: opened.routingId,
    data: {
      sessionId: opened.routingId,
      state: { sessionId: `durable-${opened.routingId}` },
      attached: opened.attached,
    },
  })
}

function refuse(socket: Socket, payload: Readonly<Record<string, unknown>>, failure: FakeHostOpenFailure): void {
  writeFrame(socket, {
    type: "response",
    id: payload.id,
    command: "open_session",
    success: false,
    error: `${failure.code}${failure.detail === undefined ? "" : `: ${failure.detail}`}`,
    errorCode: failure.code,
    ...(failure.data === undefined ? {} : { errorData: failure.data }),
  })
}
