// A minimal Chrome DevTools Protocol client.
//
// Transport-agnostic on purpose: `chrome.ts` drives it over Chromium's stdio debugging pipe (no TCP
// port, so nothing on this machine can reach the browser), and the tests drive it over a fake
// transport. The client knows nothing about pipes, sockets or framing - it exchanges whole JSON
// messages.

import { recordOf } from "./json"

/** A duplex carrier of complete CDP JSON messages. Framing belongs to the transport. */
export type CdpTransport = {
  write(message: string): void
  onMessage(handler: (message: string) => void): void
  onClose(handler: (reason: string) => void): void
  close(): void
}

/** An error the browser returned for a command. */
export class CdpError extends Error {
  readonly method: string
  readonly code: number

  constructor(method: string, code: number, message: string) {
    super(`${method} failed: ${message}`)
    this.name = "CdpError"
    this.method = method
    this.code = code
  }
}

export type CdpEventListener = (params: Record<string, unknown>, sessionId: string | undefined) => void

type Pending = { method: string; resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }

const DEFAULT_TIMEOUT_MS = 30_000



export class CdpConnection {
  private readonly transport: CdpTransport
  private readonly pending = new Map<number, Pending>()
  private readonly listeners = new Map<string, Set<CdpEventListener>>()
  private seq = 0
  private closed: string | null = null

  constructor(transport: CdpTransport) {
    this.transport = transport
    transport.onMessage((message) => {
      this.receive(message)
    })
    transport.onClose((reason) => {
      this.fail(reason)
    })
  }

  get isClosed(): boolean {
    return this.closed !== null
  }

  /**
   * Send one command. Every command is bounded: a browser that stops answering rejects the caller
   * instead of hanging the call forever.
   */
  send(method: string, params: Record<string, unknown> = {}, options: { sessionId?: string; timeoutMs?: number } = {}): Promise<Record<string, unknown>> {
    if (this.closed !== null) return Promise.reject(new Error(`cdp connection is closed (${this.closed})`))
    const id = ++this.seq
    const frame = JSON.stringify({ id, method, params, ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }) })
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS} ms`))
      }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
      this.pending.set(id, { method, resolve, reject, timer })
      try {
        this.transport.write(frame)
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  /** Subscribe to a protocol event. Returns the unsubscribe function. */
  on(method: string, listener: CdpEventListener): () => void {
    const set = this.listeners.get(method) ?? new Set<CdpEventListener>()
    set.add(listener)
    this.listeners.set(method, set)
    return () => {
      set.delete(listener)
    }
  }

  /**
   * Resolve when `method` fires and `match` accepts it, or reject after `timeoutMs`. This is the
   * only sanctioned way to wait for something the browser does: never a sleep, never a poll.
   */
  once(method: string, match: (params: Record<string, unknown>, sessionId: string | undefined) => boolean, timeoutMs: number): Promise<{ params: Record<string, unknown>; sessionId: string | undefined }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off()
        reject(new Error(`timed out after ${timeoutMs} ms waiting for ${method}`))
      }, timeoutMs)
      const off = this.on(method, (params, sessionId) => {
        if (!match(params, sessionId)) return
        clearTimeout(timer)
        off()
        resolve({ params, sessionId })
      })
    })
  }

  close(): void {
    this.transport.close()
    this.fail("closed by the client")
  }

  private receive(message: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(message)
    } catch {
      return
    }
    const frame = recordOf(parsed)
    const id = typeof frame.id === "number" ? frame.id : null
    if (id !== null) {
      const pending = this.pending.get(id)
      if (pending === undefined) return
      this.pending.delete(id)
      clearTimeout(pending.timer)
      const error = recordOf(frame.error)
      if (Object.keys(error).length > 0) {
        pending.reject(new CdpError(pending.method, typeof error.code === "number" ? error.code : 0, typeof error.message === "string" ? error.message : "unknown protocol error"))
        return
      }
      pending.resolve(recordOf(frame.result))
      return
    }
    const method = typeof frame.method === "string" ? frame.method : null
    if (method === null) return
    const sessionId = typeof frame.sessionId === "string" ? frame.sessionId : undefined
    for (const listener of this.listeners.get(method) ?? []) listener(recordOf(frame.params), sessionId)
  }

  private fail(reason: string): void {
    if (this.closed !== null) return
    this.closed = reason
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error(`${pending.method} lost the browser connection (${reason})`))
    }
    this.pending.clear()
  }
}
