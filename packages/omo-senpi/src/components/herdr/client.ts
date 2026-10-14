import { createConnection, type Socket } from "node:net"
import { win32 } from "node:path"

export const HERDR_SOURCE = "custom:omo"

/**
 * Minimal newline-delimited JSON-RPC client for the Herdr pane socket (HERDR_SOCKET_PATH).
 * Same wire contract senpi's builtin reporter uses: `{"id", "method", "params"}` written on
 * connect, answered by `{"id", "result"}` or `{"id", "error"}` on the first line. Requests queue
 * and drain serially; each attempt has a short timeout and every failure is reported to the
 * caller instead of throwing — Herdr must never take the agent down with it.
 */

// Shared across runtime replacements: a reload in the same millisecond must not restart below the
// previous instance's sequence, even when the clock goes back.
let sequence = 0

export interface HerdrSocketLike {
  on(event: "error" | "end" | "close" | "connect" | "data", listener: (arg?: unknown) => void): void
  write(chunk: string): void
  destroy(): void
}

export type HerdrConnect = (target: string) => HerdrSocketLike

export interface HerdrClientDeps {
  readonly now?: () => number
  readonly connect?: HerdrConnect
  readonly source?: string
  readonly firstAttemptTimeoutMs?: number
  readonly secondAttemptTimeoutMs?: number
}

export function herdrSocketTarget(path: string, platform: NodeJS.Platform = process.platform): string {
  return platform !== "win32" || /^\\\\[.?]\\pipe\\/i.test(path) ? path : win32.join("\\\\.\\pipe\\", path)
}

const defaultConnect: HerdrConnect = (target) => createConnection(target) as unknown as HerdrSocketLike

interface HerdrRequest {
  readonly id: string
  readonly method: string
  readonly params: Record<string, unknown>
}

export class HerdrClient {
  private readonly target: string
  private readonly paneId: string
  private readonly source: string
  private readonly now: () => number
  private readonly connect: HerdrConnect
  private readonly firstAttemptTimeoutMs: number
  private readonly secondAttemptTimeoutMs: number
  private queue: { request: HerdrRequest; resolve: () => void; reject: (error: Error) => void }[] = []
  private draining = false

  constructor(socketPath: string, paneId: string, deps: HerdrClientDeps = {}) {
    this.target = herdrSocketTarget(socketPath)
    this.paneId = paneId
    this.source = deps.source ?? HERDR_SOURCE
    this.now = deps.now ?? (() => Date.now())
    this.connect = deps.connect ?? defaultConnect
    this.firstAttemptTimeoutMs = deps.firstAttemptTimeoutMs ?? 500
    this.secondAttemptTimeoutMs = deps.secondAttemptTimeoutMs ?? 1500
  }

  send(method: string, params: Record<string, unknown>): Promise<void> {
    sequence = Math.max(sequence + 1, Math.floor(this.now()) * 1000)
    const request: HerdrRequest = {
      id: `${this.source}:${sequence}`,
      method,
      params: { ...params, pane_id: this.paneId, source: this.source, seq: sequence },
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ request, resolve, reject })
      void this.drain()
    })
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift()!
        if ((await this.attempt(next.request, this.firstAttemptTimeoutMs)) ||
            (await this.attempt(next.request, this.secondAttemptTimeoutMs))) {
          next.resolve()
        } else {
          next.reject(new Error(`Herdr request failed after two attempts: ${next.request.method}`))
        }
      }
    } finally {
      this.draining = false
    }
  }

  private attempt(request: HerdrRequest, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      let socket: HerdrSocketLike
      try {
        socket = this.connect(this.target)
      } catch {
        resolve(false)
        return
      }
      let finished = false
      let buffer = ""
      const finish = (success: boolean) => {
        if (finished) return
        finished = true
        clearTimeout(timeout)
        socket.destroy()
        resolve(success)
      }
      const timeout = setTimeout(() => finish(false), timeoutMs)
      timeout.unref?.()
      socket.on("error", () => finish(false))
      socket.on("end", () => finish(false))
      socket.on("close", () => finish(false))
      socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`))
      socket.on("data", (chunk) => {
        buffer += String(chunk)
        if (buffer.length > 65_536) {
          finish(false)
          return
        }
        const newline = buffer.indexOf("\n")
        if (newline < 0) return
        try {
          const response = JSON.parse(buffer.slice(0, newline)) as unknown
          finish(
            typeof response === "object" &&
              response !== null &&
              "id" in response &&
              (response as Record<string, unknown>).id === request.id &&
              "result" in response &&
              !("error" in response),
          )
        } catch {
          finish(false)
        }
      })
    })
  }
}
