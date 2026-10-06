// A JSON-RPC client for one `senpi-desktop-engine --stdio` process. The QA driver is the host that
// spawned it, so the host-only methods (`session.open`, `stopPath.*`) are available.
import { type ChildProcess, spawn } from "node:child_process"
import { createInterface } from "node:readline"
import type { Readable, Writable } from "node:stream"

import { HANG_GUARD_MS, hangGuard } from "./until"

export const DEFAULT_STOP_CHORD = "ctrl+alt+shift+escape"
// The host's heartbeat cadence while a session is active (crates/senpi-desktop-engine/src/outbox.rs).
const HOST_HEARTBEAT_MS = 500

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type JsonObject = { [key: string]: Json }

export interface RpcError {
  readonly code: number
  readonly message: string
  readonly data?: Json
}

export interface Reply {
  readonly result?: Json
  readonly error?: RpcError
}

export interface EngineNotification {
  readonly method: string
  readonly params: Json
}

/** The engine error code (`error.data.code`), `rpc<code>` for a protocol error, `undefined` on success. */
export function errorCode(reply: Reply): string | undefined {
  if (reply.error === undefined) return undefined
  const data = reply.error.data
  if (data !== null && typeof data === "object" && !Array.isArray(data) && typeof data.code === "string") {
    return data.code
  }
  return `rpc${reply.error.code}`
}

export function asObject(value: Json | undefined): JsonObject {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`expected a JSON object, got ${JSON.stringify(value)}`)
  }
  return value
}

function rpcError(value: Json): RpcError {
  const error = asObject(value)
  const code = typeof error.code === "number" ? error.code : -32603
  const message = typeof error.message === "string" ? error.message : JSON.stringify(error)
  return error.data === undefined ? { code, message } : { code, message, data: error.data }
}

interface Pending {
  readonly resolve: (reply: Reply) => void
  readonly timer: ReturnType<typeof setTimeout>
}

type NotificationListener = (notification: EngineNotification) => void

export class Engine {
  readonly notifications: EngineNotification[] = []
  readonly pid: number
  resumeToken = ""
  private readonly pending = new Map<number, Pending>()
  private readonly listeners = new Set<NotificationListener>()
  private readonly exited: Promise<number | null>
  private stderr = ""
  private nextId = 1

  private constructor(
    private readonly child: ChildProcess,
    private readonly stdin: Writable,
    stdout: Readable,
  ) {
    this.pid = child.pid ?? 0
    this.exited = new Promise((resolve) => child.once("exit", (code) => resolve(code)))
    child.stderr?.on("data", (chunk: Buffer) => {
      this.stderr += chunk.toString("utf8")
    })
    createInterface({ input: stdout }).on("line", (line) => this.receive(line))
    child.once("exit", () => {
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer)
        pending.resolve({ error: { code: -32000, message: `engine exited before answering #${id}` } })
      }
      this.pending.clear()
    })
  }

  static spawn(binary: string): Engine {
    const env: NodeJS.ProcessEnv = { ...process.env }
    // The QA run drives the real win32 backend, never a scripted fake inherited from the runner.
    delete env.SENPI_DESKTOP_BACKEND
    const child = spawn(binary, ["--stdio"], { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
    if (child.pid === undefined || child.stdin === null || child.stdout === null) {
      throw new Error(`could not spawn ${binary}`)
    }
    return new Engine(child, child.stdin, child.stdout)
  }

  private receive(line: string): void {
    if (line.trim() === "") return
    const parsed: Json = JSON.parse(line)
    const message = asObject(parsed)
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id)
      if (pending === undefined) return
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      pending.resolve(
        message.error === undefined ? { result: message.result ?? null } : { error: rpcError(message.error) },
      )
      return
    }
    if (typeof message.method !== "string") return
    const notification = { method: message.method, params: message.params ?? null }
    this.notifications.push(notification)
    for (const listener of this.listeners) listener(notification)
  }

  call(method: string, params: JsonObject = {}): Promise<Reply> {
    const id = this.nextId++
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve({ error: { code: -32000, message: `hang guard: ${method} unanswered after ${HANG_GUARD_MS} ms` } })
      }, HANG_GUARD_MS)
      this.pending.set(id, { resolve, timer })
      this.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
    })
  }

  async result(method: string, params: JsonObject = {}): Promise<Json> {
    const reply = await this.call(method, params)
    if (reply.error !== undefined) {
      throw new Error(`${method} failed: ${errorCode(reply)} ${reply.error.message}`)
    }
    return reply.result ?? null
  }

  /**
   * The first notification matching `matches`, already received or still to come; `undefined` when
   * none arrives before the hang guard. History is checked before listening, so a notification that
   * rode out behind an earlier reply is not missed.
   */
  async waitForNotification(matches: (notification: EngineNotification) => boolean): Promise<EngineNotification | undefined> {
    const seen = this.notifications.find(matches)
    if (seen !== undefined) return seen
    let listener: NotificationListener | undefined
    const arrived = new Promise<EngineNotification | undefined>((resolve) => {
      listener = (notification) => {
        if (matches(notification)) resolve(notification)
      }
      this.listeners.add(listener)
    })
    try {
      return await hangGuard(arrived, () => undefined)
    } finally {
      if (listener !== undefined) this.listeners.delete(listener)
    }
  }

  /**
   * Heartbeats like the host does while a session is active. Notifications leave the engine only
   * behind a reply, so this is the channel that delivers a listener's transitions. Returns the stop.
   */
  hostHeartbeat(): () => void {
    const interval = setInterval(() => void this.call("stopPath.heartbeat"), HOST_HEARTBEAT_MS)
    return () => clearInterval(interval)
  }

  /** Opens the session and arms the stop paths the way the host does after activation. */
  async activate(options: JsonObject = {}, chord = DEFAULT_STOP_CHORD): Promise<JsonObject> {
    const opened = asObject(await this.result("session.open", { allowHostRelayOnlyStop: true, ...options }))
    this.resumeToken = String(opened.resumeToken)
    return asObject(await this.result("stopPath.start", { chord }))
  }

  async exec(method: string, params: JsonObject): Promise<Reply> {
    await this.call("stopPath.heartbeat")
    return this.call(method, params)
  }

  async close(): Promise<string> {
    if (this.child.exitCode === null) {
      await this.call("session.close")
      this.stdin.end()
    }
    let code = await hangGuard<number | null | "hang-guard">(this.exited, () => "hang-guard")
    if (code === "hang-guard") {
      this.child.kill()
      code = await this.exited
    }
    const stderr = this.stderr.trim()
    return `engine pid ${this.pid} exited ${code}${stderr === "" ? "" : `; stderr: ${stderr}`}`
  }
}
