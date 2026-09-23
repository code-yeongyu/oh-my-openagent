import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import type { Socket } from "node:net"
import { dirname } from "node:path"

/**
 * The fake daemon's session half: who holds which session path, what `list_sessions` answers, and
 * which paths a draining generation still owns. It speaks the real host's rules - a retained
 * session survives its last connection, a path held by another owner refuses `open_session`, and
 * worker rows stay out of a default listing - and knows nothing about sockets beyond identity.
 */

export interface FakeHostSession {
  readonly routingId: string
  readonly sessionPath: string
  readonly kind: unknown
  readonly context: unknown
  readonly retainOnDisconnect: unknown
  readonly autoTitle: unknown
  readonly attachments: number
  readonly parked: boolean
}

/** A session path a previous generation still owns while it drains. */
export interface FakeSessionHold {
  readonly owner: string
  readonly retryAfterMs: number
}

export type FakeOpenOutcome =
  | { readonly kind: "opened"; readonly routingId: string; readonly attached: boolean }
  | { readonly kind: "held"; readonly hold: FakeSessionHold }

/** A session that just left the live table, with the connections it still has to be told about. */
export interface FakeDrainedSession {
  readonly routingId: string
  readonly sessionPath: string
  readonly attachments: readonly Socket[]
}

export interface FakeHostSessionRow {
  readonly sessionId: string
  readonly sessionPath: string
  readonly kind: unknown
  readonly context: unknown
}

interface LiveSession {
  routingId: string
  readonly sessionPath: string
  readonly kind: unknown
  readonly context: unknown
  readonly retainOnDisconnect: unknown
  readonly autoTitle: unknown
  readonly attachments: Set<Socket>
  parked: boolean
  streaming: boolean
}

export class FakeSessionTable {
  readonly #sessions = new Map<string, LiveSession>()
  readonly #holds = new Map<string, FakeSessionHold>()
  readonly #peaks = new Map<string, number>()
  readonly #transcripts: boolean
  #nextRoutingId = 0

  /** With `transcripts`, every session path becomes a real JSONL file, as a daemon's would. */
  constructor(options: { readonly transcripts: boolean }) {
    this.#transcripts = options.transcripts
  }

  open(socket: Socket, sessionPath: string, payload: Readonly<Record<string, unknown>>): FakeOpenOutcome {
    const hold = this.#holds.get(sessionPath)
    if (hold !== undefined) return { kind: "held", hold }
    const existing = this.#sessions.get(sessionPath)
    const session = existing ?? this.#create(sessionPath, payload)
    // A session nobody holds is re-opened under a FRESH routing handle; one another connection
    // still holds keeps its handle and counts one more attachment, exactly like the real host.
    if (existing !== undefined && existing.attachments.size === 0) session.routingId = this.#mintRouting()
    session.attachments.add(socket)
    this.#peaks.set(sessionPath, Math.max(this.#peaks.get(sessionPath) ?? 0, session.attachments.size))
    session.parked = false
    this.#sessions.set(sessionPath, session)
    return { kind: "opened", routingId: session.routingId, attached: existing !== undefined }
  }

  attachmentsOf(routingId: string): readonly Socket[] {
    return [...(this.#byRouting(routingId)?.attachments ?? [])]
  }

  /** The turn record a daemon appends: the child's prompt, then whatever the turn answered. */
  appendTranscript(routingId: string, entry: Readonly<Record<string, unknown>>): void {
    const session = this.#byRouting(routingId)
    if (session === undefined || !this.#transcripts) return
    appendFileSync(session.sessionPath, `${JSON.stringify({ type: "message", message: entry })}\n`)
  }

  /** The connection went away: retained sessions stay, the rest end with it. */
  detach(socket: Socket): readonly LiveSession[] {
    const closed: LiveSession[] = []
    for (const [path, session] of this.#sessions) {
      if (!session.attachments.delete(socket)) continue
      if (session.attachments.size > 0 || session.retainOnDisconnect === true) continue
      this.#sessions.delete(path)
      closed.push(session)
    }
    return closed
  }

  close(routingId: string): FakeDrainedSession | undefined {
    const session = this.#byRouting(routingId)
    if (session === undefined) return undefined
    this.#sessions.delete(session.sessionPath)
    return drained(session)
  }

  /** The daemon parked the session to its JSONL: still reopenable, no longer listed as live. */
  park(sessionPath: string): FakeDrainedSession | undefined {
    const session = this.#sessions.get(sessionPath)
    if (session === undefined) return undefined
    const parked = drained(session)
    session.parked = true
    session.attachments.clear()
    return parked
  }

  hold(sessionPath: string, owner: string, retryAfterMs: number): void {
    this.#holds.set(sessionPath, { owner, retryAfterMs })
  }

  release(sessionPath: string): void {
    this.#holds.delete(sessionPath)
  }

  /**
   * A newer generation takes the socket: every session it inherited is parked, its path stays
   * owned by the old generation until that one drains, and the new generation starts empty.
   */
  handoff(previousInstanceId: string, retryAfterMs: number): readonly FakeDrainedSession[] {
    const inherited = [...this.#sessions.values()].map(drained)
    for (const session of inherited) this.hold(session.sessionPath, previousInstanceId, retryAfterMs)
    this.#sessions.clear()
    return inherited
  }

  /** The host process died: nothing survives in memory, only the transcripts on disk. */
  clear(): void {
    this.#sessions.clear()
  }

  /**
   * The most connections that ever held this path at once, across every generation of the session.
   * One writer per JSONL file is the contract a handoff must not break, so the peak is kept even
   * after the session itself is parked, closed or drained away.
   */
  peakAttachments(sessionPath: string): number {
    return this.#peaks.get(sessionPath) ?? 0
  }

  rows(includeWorkers: boolean): readonly FakeHostSessionRow[] {
    return [...this.#sessions.values()].flatMap((session) =>
      session.parked || (session.kind === "worker" && !includeWorkers)
        ? []
        : [{ sessionId: session.routingId, sessionPath: session.sessionPath, kind: session.kind, context: session.context }],
    )
  }

  view(): readonly FakeHostSession[] {
    return [...this.#sessions.values()].map((session) => ({
      routingId: session.routingId,
      sessionPath: session.sessionPath,
      kind: session.kind,
      context: session.context,
      retainOnDisconnect: session.retainOnDisconnect,
      autoTitle: session.autoTitle,
      attachments: session.attachments.size,
      parked: session.parked,
    }))
  }

  #byRouting(routingId: string): LiveSession | undefined {
    for (const session of this.#sessions.values()) if (session.routingId === routingId) return session
    return undefined
  }

  #create(sessionPath: string, payload: Readonly<Record<string, unknown>>): LiveSession {
    if (this.#transcripts) {
      mkdirSync(dirname(sessionPath), { recursive: true })
      writeFileSync(sessionPath, "", { flag: "a" })
    }
    return {
      routingId: this.#mintRouting(),
      sessionPath,
      kind: payload.kind,
      context: payload.context,
      retainOnDisconnect: payload.retain_on_disconnect,
      autoTitle: payload.auto_title,
      attachments: new Set<Socket>(),
      parked: false,
      streaming: false,
    }
  }

  setStreaming(routingId: string, streaming: boolean): void {
    const session = this.#byRouting(routingId)
    if (session !== undefined) session.streaming = streaming
  }

  isStreaming(routingId: string): boolean {
    return this.#byRouting(routingId)?.streaming === true
  }

  #mintRouting(): string {
    this.#nextRoutingId += 1
    return `routing-${this.#nextRoutingId}`
  }
}

function drained(session: LiveSession): FakeDrainedSession {
  return { routingId: session.routingId, sessionPath: session.sessionPath, attachments: [...session.attachments] }
}
