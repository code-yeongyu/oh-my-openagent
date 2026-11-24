import { spawn, type ChildProcess } from "node:child_process"

import type {
  AcpErrorShape,
  AcpId,
  AcpInitializeResult,
  AcpNotification,
  AcpPromptResult,
  AcpRequest,
  AcpResponse,
  AcpServerRequest,
  AcpSessionResult,
  AcpSessionUpdateParams,
} from "./protocol"

const RPC_ID_START = 2 ** 30
const CONTROL_REQUEST_TIMEOUT_MS = 30_000
// ACP stderr is the agent's own log channel (devin logs as "chisel"); it is captured into a bounded
// tail so a dead child still explains itself, never forwarded line-by-line into the parent's stream.
const STDERR_TAIL_BYTES = 64 * 1024

export interface AcpSpawnDescriptor {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
}

export interface AcpClientOptions {
  readonly spawn?: (descriptor: AcpSpawnDescriptor) => ChildProcess
  readonly onSessionUpdate?: (params: AcpSessionUpdateParams) => void
  readonly onNotification?: (method: string, params: unknown) => void
  readonly onExit?: (info: { readonly code: number | null; readonly signal: NodeJS.Signals | null }) => void
  // Answers agent->client requests. Returning a value sends it as `result`; throwing an
  // AcpRequestError sends `error`. Unimplemented methods should throw AcpRequestError.methodNotFound.
  readonly onServerRequest?: (request: AcpServerRequest) => Promise<unknown>
}

export class AcpRequestError extends Error {
  readonly code: number
  readonly data: unknown

  constructor(error: AcpErrorShape) {
    super(error.message)
    this.name = "AcpRequestError"
    this.code = error.code
    this.data = error.data
  }

  static is(value: unknown): value is AcpRequestError {
    return value instanceof AcpRequestError
  }

  static methodNotFound(method: string): AcpRequestError {
    return new AcpRequestError({ code: -32601, message: `method not found: ${method}` })
  }

  static invalidParams(message: string): AcpRequestError {
    return new AcpRequestError({ code: -32602, message })
  }
}

export class AcpClient {
  readonly child: ChildProcess
  #nextId = RPC_ID_START
  #buffer = ""
  #stderrTail = ""
  #closed = false
  #pending = new Map<
    AcpId,
    { readonly resolve: (value: unknown) => void; readonly reject: (error: Error) => void }
  >()
  readonly #options: AcpClientOptions

  constructor(descriptor: AcpSpawnDescriptor, options: AcpClientOptions = {}) {
    this.#options = options
    const spawnChild =
      options.spawn ??
      ((d: AcpSpawnDescriptor) =>
        spawn(d.command, [...d.args], {
          cwd: d.cwd,
          env: d.env,
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
          windowsHide: true,
          detached: process.platform !== "win32",
        }))
    this.child = spawnChild(descriptor)
    this.child.stdout?.setEncoding("utf8")
    this.child.stdout?.on("data", (chunk: string) => this.#onStdout(chunk))
    this.child.stderr?.setEncoding("utf8")
    this.child.stderr?.on("data", (chunk: string) => {
      this.#stderrTail = (this.#stderrTail + chunk).slice(-STDERR_TAIL_BYTES)
    })
    // A stdio stream 'error' (EPIPE on a write racing process death, a failed read) is NOT covered
    // by the ChildProcess 'error' event: unhandled it becomes an uncaughtException in the host.
    this.child.stdin?.on("error", (error) => this.#failAll(error))
    this.child.stdout?.on("error", (error) => this.#failAll(error))
    this.child.stderr?.on("error", (error) => this.#failAll(error))
    this.child.on("error", (error) => this.#failAll(error))
    this.child.on("exit", (code, signal) => {
      this.#closed = true
      this.#failAll(new Error(`devin acp exited (code=${code ?? "null"} signal=${signal ?? "null"})`))
      options.onExit?.({ code, signal })
    })
    this.child.on("close", () => {
      this.#closed = true
    })
  }

  get closed(): boolean {
    return this.#closed || this.child.exitCode !== null || this.child.signalCode !== null
  }

  get pid(): number | undefined {
    return this.child.pid
  }

  stderrTail(): string {
    return this.#stderrTail.trim()
  }

  async request<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    if (this.closed) throw new Error("devin acp is not running")
    const id = ++this.#nextId
    const message: AcpRequest = { jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }
    const response = await new Promise<AcpResponse>((resolve, reject) => {
      const timer =
        timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              this.#pending.delete(id)
              reject(new Error(`ACP request ${method} timed out after ${timeoutMs}ms`))
            }, timeoutMs)
      timer?.unref?.()
      this.#pending.set(id, {
        resolve: (value) => {
          if (timer !== undefined) clearTimeout(timer)
          resolve(value as AcpResponse)
        },
        reject: (error) => {
          if (timer !== undefined) clearTimeout(timer)
          reject(error)
        },
      })
      this.#write(message)
    })
    if (response.error !== undefined) throw new AcpRequestError(response.error)
    return response.result as T
  }

  // Control-plane calls get the bounded deadline; session/prompt passes timeoutMs: undefined and
  // is settled only by its response, session/cancel, or process exit - a Devin turn has no SLA.
  initialize(params: unknown): Promise<AcpInitializeResult> {
    return this.request("initialize", params, CONTROL_REQUEST_TIMEOUT_MS)
  }

  authenticate(methodId: string): Promise<unknown> {
    return this.request("authenticate", { methodId }, CONTROL_REQUEST_TIMEOUT_MS)
  }

  sessionNew(params: unknown): Promise<AcpSessionResult> {
    return this.request("session/new", params, CONTROL_REQUEST_TIMEOUT_MS)
  }

  sessionLoad(params: unknown): Promise<AcpSessionResult> {
    return this.request("session/load", params, CONTROL_REQUEST_TIMEOUT_MS)
  }

  sessionClose(sessionId: string): Promise<unknown> {
    return this.request("session/close", { sessionId }, CONTROL_REQUEST_TIMEOUT_MS)
  }

  sessionSetConfigOption(sessionId: string, configId: string, value: string): Promise<AcpSessionResult> {
    return this.request(
      "session/set_config_option",
      { sessionId, configId, value },
      CONTROL_REQUEST_TIMEOUT_MS,
    )
  }

  sessionPrompt(sessionId: string, text: string): Promise<AcpPromptResult> {
    return this.request(
      "session/prompt",
      { sessionId, prompt: [{ type: "text", text }] },
      undefined,
    )
  }

  sessionCancel(sessionId: string): void {
    this.notify({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } })
  }

  notify(message: AcpNotification): void {
    this.#write(message)
  }

  #write(message: AcpRequest | AcpNotification | AcpResponse): void {
    const stdin = this.child.stdin
    if (stdin === null || stdin.destroyed) return
    stdin.write(`${JSON.stringify(message)}\n`)
  }

  #onStdout(chunk: string): void {
    this.#buffer += chunk
    let index = this.#buffer.indexOf("\n")
    while (index >= 0) {
      const line = this.#buffer.slice(0, index)
      this.#buffer = this.#buffer.slice(index + 1)
      index = this.#buffer.indexOf("\n")
      if (line.trim().length === 0) continue
      this.#dispatch(line)
    }
  }

  #dispatch(line: string): void {
    let message: AcpResponse | AcpNotification | AcpServerRequest
    try {
      message = JSON.parse(line) as AcpResponse | AcpNotification | AcpServerRequest
    } catch {
      return
    }
    if (typeof message !== "object" || message === null) return
    const record = message as unknown as Record<string, unknown>
    const hasMethod = typeof record.method === "string"
    const hasId = record.id !== undefined && record.id !== null
    if (hasMethod && hasId) {
      void this.#answerServerRequest(record as unknown as AcpServerRequest)
      return
    }
    if (hasMethod) {
      const params = record.params
      // Observer callbacks run inside the stdout 'data' handler: a throw there is an
      // uncaughtException in the host, so dispatch isolates them and malformed params never reach
      // the handle unguarded.
      try {
        if (record.method === "session/update") {
          this.#options.onSessionUpdate?.(params as AcpSessionUpdateParams)
        }
        this.#options.onNotification?.(record.method as string, params)
      } catch {
        // A buggy observer must not kill the client's read loop.
      }
      return
    }
    if (hasId) {
      const pending = this.#pending.get(record.id as AcpId)
      if (pending === undefined) return
      this.#pending.delete(record.id as AcpId)
      const error = record.error as AcpErrorShape | undefined
      if (error !== undefined) pending.reject(new AcpRequestError(error))
      else pending.resolve(record)
    }
  }

  async #answerServerRequest(request: AcpServerRequest): Promise<void> {
    try {
      const result = this.#options.onServerRequest
        ? await this.#options.onServerRequest(request)
        : (() => {
            throw AcpRequestError.methodNotFound(request.method)
          })()
      this.#write({ jsonrpc: "2.0", id: request.id, result: result ?? {} })
    } catch (error) {
      const shaped =
        error instanceof AcpRequestError
          ? { code: error.code, message: error.message, ...(error.data === undefined ? {} : { data: error.data }) }
          : { code: -32603, message: error instanceof Error ? error.message : String(error) }
      this.#write({ jsonrpc: "2.0", id: request.id, error: shaped })
    }
  }

  #failAll(error: Error): void {
    for (const pending of this.#pending.values()) pending.reject(error)
    this.#pending.clear()
  }

  async dispose(): Promise<void> {
    if (this.closed) return
    try {
      this.child.stdin?.end()
    } catch {
      // stdin already gone
    }
    await terminateChild(this.child)
  }
}

// POSIX: signal the whole process group (the child spawns detached); win32: taskkill the tree.
export async function terminateChild(child: ChildProcess): Promise<void> {
  const pid = child.pid
  if (pid === undefined) return
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
      killer.on("exit", () => resolve())
      killer.on("error", () => resolve())
    })
    return
  }
  try {
    process.kill(-pid, "SIGTERM")
  } catch {
    try {
      child.kill("SIGTERM")
    } catch {
      // already gone
    }
  }
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  try {
    process.kill(-pid, "SIGKILL")
  } catch {
    try {
      child.kill("SIGKILL")
    } catch {
      // already gone
    }
  }
}
