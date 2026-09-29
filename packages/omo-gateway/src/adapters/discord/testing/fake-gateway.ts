import type { ServerWebSocket } from "bun"
import { isJson } from "../wire"

export type SocketData = { socket: number; session: string | null }
export type ReceivedOp = { op: number; socket: number; session_id: string | null; seq: number | null; intents: number | null }
type Dispatch = { s: number; t: string; d: unknown }
type Session = { id: string; seq: number; events: Dispatch[]; socket: ServerWebSocket<SocketData> | null; valid: boolean }

export type FakeGatewayHooks = {
  token: string
  resumeUrl(): string
  readyPayload(session_id: string): unknown
  guildCreate(): unknown
}

/**
 * The fake Discord gateway: HELLO, heartbeat ACKs, identify -> READY + GUILD_CREATE, resume with
 * replay of the events a session missed, op 9 for a resume of an unknown or invalidated session,
 * close 4004 for a bad token. Sessions buffer dispatches while their socket is gone, as Discord does.
 */
export class FakeDiscordGateway {
  readonly ops: ReceivedOp[] = []
  ackHeartbeats = true
  heartbeatInterval = 45_000
  private readonly sessions = new Map<string, Session>()
  private readonly sockets = new Set<ServerWebSocket<SocketData>>()
  private readonly waiters = new Set<() => void>()
  private sessionCount = 0

  constructor(private readonly hooks: FakeGatewayHooks) {}

  get openSockets(): number {
    return this.sockets.size
  }

  open(ws: ServerWebSocket<SocketData>): void {
    this.sockets.add(ws)
    ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: this.heartbeatInterval }, s: null, t: null }))
    this.notify()
  }

  message(ws: ServerWebSocket<SocketData>, raw: string | Buffer): void {
    let frame: unknown
    try {
      frame = JSON.parse(String(raw))
    } catch {
      return
    }
    if (!isJson(frame) || typeof frame.op !== "number") return
    const d = isJson(frame.d) ? frame.d : {}
    const session_id = typeof d.session_id === "string" ? d.session_id : null
    this.ops.push({ op: frame.op, socket: ws.data.socket, session_id, seq: typeof d.seq === "number" ? d.seq : frame.op === 1 && typeof frame.d === "number" ? frame.d : null,
      intents: typeof d.intents === "number" ? d.intents : null,
    })
    if (frame.op === 1 && this.ackHeartbeats) ws.send(JSON.stringify({ op: 11 }))
    if (frame.op === 2) this.identify(ws, d.token)
    if (frame.op === 6) this.resume(ws, session_id, d.token, typeof d.seq === "number" ? d.seq : 0)
    this.notify()
  }

  close(ws: ServerWebSocket<SocketData>, code: number): void {
    this.sockets.delete(ws)
    const session = ws.data.session === null ? undefined : this.sessions.get(ws.data.session)
    if (session !== undefined && session.socket === ws) {
      session.socket = null
      if (code === 1000 || code === 1001) session.valid = false
    }
    this.notify()
  }

  broadcast(t: string, d: unknown): void {
    for (const session of this.sessions.values()) if (session.valid) this.deliver(session, t, d)
  }

  closeSockets(code: number): void {
    for (const ws of this.sockets) ws.close(code, "fake gateway close")
  }

  invalidateSessions(resumable: boolean): void {
    for (const ws of this.sockets) {
      const session = ws.data.session === null ? undefined : this.sessions.get(ws.data.session)
      if (session !== undefined && !resumable) session.valid = false
      ws.send(JSON.stringify({ op: 9, d: resumable, s: null, t: null }))
    }
  }

  forgetSessions(): void {
    for (const session of this.sessions.values()) session.valid = false
  }

  requestReconnect(): void {
    for (const ws of this.sockets) ws.send(JSON.stringify({ op: 7, d: null, s: null, t: null }))
  }

  sendRaw(text: string): void {
    for (const ws of this.sockets) ws.send(text)
  }

  /** Resolve once `predicate` holds for the received ops (checked on every op and socket change). */
  waitFor(predicate: (ops: readonly ReceivedOp[]) => boolean, ms: number, what: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (!predicate(this.ops)) return
        this.waiters.delete(check)
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(() => {
        this.waiters.delete(check)
        reject(new Error(`fake gateway: waited ${ms} ms for ${what}; ops were ${JSON.stringify(this.ops.map((op) => op.op))}`))
      }, ms)
      this.waiters.add(check)
      check()
    })
  }

  private notify(): void {
    for (const waiter of [...this.waiters]) waiter()
  }

  private deliver(session: Session, t: string, d: unknown): void {
    session.seq += 1
    const dispatch = { s: session.seq, t, d }
    session.events.push(dispatch)
    session.socket?.send(JSON.stringify({ op: 0, ...dispatch }))
  }

  private identify(ws: ServerWebSocket<SocketData>, token: unknown): void {
    if (token !== this.hooks.token) {
      ws.close(4004, "Authentication failed.")
      return
    }
    this.sessionCount += 1
    const session: Session = { id: `fake-session-${this.sessionCount}`, seq: 0, events: [], socket: ws, valid: true }
    this.sessions.set(session.id, session)
    ws.data.session = session.id
    this.deliver(session, "READY", this.hooks.readyPayload(session.id))
    this.deliver(session, "GUILD_CREATE", this.hooks.guildCreate())
  }

  private resume(ws: ServerWebSocket<SocketData>, session_id: string | null, token: unknown, seq: number): void {
    const session = session_id === null ? undefined : this.sessions.get(session_id)
    if (session === undefined || !session.valid || token !== this.hooks.token) {
      ws.send(JSON.stringify({ op: 9, d: false, s: null, t: null }))
      return
    }
    session.socket = ws
    ws.data.session = session.id
    for (const dispatch of session.events) if (dispatch.s > seq) ws.send(JSON.stringify({ op: 0, ...dispatch }))
    this.deliver(session, "RESUMED", null)
  }
}
