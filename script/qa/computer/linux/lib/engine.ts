// The stdio JSON-RPC peer the scenarios drive, and the three admissions of the plan's
// '### Real-surface QA drivers': `os` opens a normal session, `host-relay` opens with
// `allowHostRelayOnlyStop` and keeps the 500 ms heartbeat up for the scenario's length, and
// `none` opens a session that sends no input and starts no stop path.
import type { Subprocess } from "bun"

import type { Admit } from "./scenario.ts"

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }
export type JsonObject = { [key: string]: Json }

const CALL_TIMEOUT_MS = 20_000
const HEARTBEAT_MS = 500

export class EngineError extends Error {
  constructor(
    readonly code: string,
    readonly data: JsonObject,
    message: string,
  ) {
    super(message)
  }
}

export class Engine {
  private readonly proc: Subprocess<"pipe", "pipe", "inherit">
  private readonly pending = new Map<number, (message: JsonObject) => void>()
  private readonly pumped: Promise<void>
  private heartbeat: ReturnType<typeof setInterval> | undefined
  private next = 1

  constructor(binary: string, env: Record<string, string | undefined>) {
    const clean = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined))
    this.proc = Bun.spawn([binary, "--stdio"], {
      env: clean as Record<string, string>,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    })
    this.pumped = this.pump()
  }

  private async pump(): Promise<void> {
    const decoder = new TextDecoder()
    let buffer = ""
    for await (const chunk of this.proc.stdout) {
      buffer += decoder.decode(chunk, { stream: true })
      for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
        const line = buffer.slice(0, at).trim()
        buffer = buffer.slice(at + 1)
        if (line === "") continue
        const message = JSON.parse(line) as JsonObject
        const id = typeof message.id === "number" ? message.id : undefined
        const waiter = id === undefined ? undefined : this.pending.get(id)
        if (id !== undefined && waiter) {
          this.pending.delete(id)
          waiter(message)
        }
      }
    }
  }

  async call(method: string, params: JsonObject = {}): Promise<Json> {
    const id = this.next++
    const settled = new Promise<JsonObject>((done, fail) => {
      this.pending.set(id, done)
      setTimeout(() => {
        if (this.pending.delete(id)) fail(new Error(`${method} did not answer within ${CALL_TIMEOUT_MS} ms`))
      }, CALL_TIMEOUT_MS)
    })
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
    this.proc.stdin.flush()
    const message = await settled
    const error = message.error
    if (error && typeof error === "object" && !Array.isArray(error)) {
      const data = (error.data ?? {}) as JsonObject
      const code = typeof data.code === "string" ? data.code : String(error.code)
      throw new EngineError(code, data, `${method}: ${String(error.message)}`)
    }
    return message.result ?? null
  }

  /** The call's typed refusal, or `undefined` when it answered. */
  async refusal(method: string, params: JsonObject = {}): Promise<EngineError | undefined> {
    try {
      await this.call(method, params)
      return undefined
    } catch (error) {
      if (error instanceof EngineError) return error
      throw error
    }
  }

  /** Opens the session for `admit` and, for `host-relay`, keeps its heartbeat up. */
  async open(admit: Admit, mode: "object" | "null" = "object"): Promise<JsonObject> {
    const params: JsonObject = mode === "object" ? { reportMode: "object" } : {}
    if (admit === "host-relay") params.allowHostRelayOnlyStop = true
    const opened = (await this.call("session.open", params)) as JsonObject
    if (admit === "host-relay") {
      await this.call("stopPath.start", {})
      this.heartbeat = setInterval(() => {
        void this.call("stopPath.heartbeat", {}).catch(() => undefined)
      }, HEARTBEAT_MS)
    }
    return opened
  }

  async close(): Promise<void> {
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat)
    this.proc.stdin.end()
    await Promise.race([this.proc.exited, Bun.sleep(5_000)])
    if (this.proc.exitCode === null) this.proc.kill("SIGKILL")
    await this.proc.exited
    await this.pumped
  }
}
