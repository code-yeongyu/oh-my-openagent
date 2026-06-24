import { isRecord } from "@oh-my-opencode/utils"
import { existsSync } from "node:fs"
import type { Socket } from "node:net"
import { homedir } from "node:os"
import { join } from "node:path"
import { connectUnixWebSocket, readWebSocketText, writeWebSocketText } from "./sparkshell-appserver-websocket"

export type RuntimeEnv = Readonly<Record<string, string | undefined>>

export type SparkShellAppServerCommand = {
  readonly argv: readonly string[]
  readonly cwd: string
  readonly env: RuntimeEnv
}

export type SparkShellAppServerResult = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export interface SparkShellAppServerClient {
  getPlatform(): Promise<NodeJS.Platform>
  exec(command: SparkShellAppServerCommand): Promise<SparkShellAppServerResult>
}

type JsonRpcResponse = {
  readonly id?: string | number
  readonly result?: unknown
  readonly error?: { readonly message?: string }
}

type InitializeResult = {
  readonly platformOs?: string
  readonly platformFamily?: string
}

type CommandExecResult = {
  readonly exitCode?: number
  readonly stdout?: string
  readonly stderr?: string
}

type ParsedJsonRpcResponse =
  | { readonly kind: "response"; readonly response: JsonRpcResponse }
  | { readonly kind: "other" }

export function createDefaultSparkShellAppServerClient(env: RuntimeEnv): SparkShellAppServerClient | null {
  const socketPath = resolveAppServerSocketPath(env)
  if (!socketPath || !existsSync(socketPath)) {
    return null
  }
  return new JsonRpcSparkShellAppServerClient(socketPath, resolveAppServerTimeoutMs(env))
}

function resolveAppServerSocketPath(env: RuntimeEnv): string | null {
  const explicit = env["CODEX_APP_SERVER_SOCKET"]?.trim() || env["OMO_SPARKSHELL_APP_SERVER_SOCKET"]?.trim()
  if (explicit) {
    return explicit
  }
  const codexHome = env["CODEX_HOME"]?.trim() || join(homedir(), ".codex")
  return join(codexHome, "app-server-control", "app-server-control.sock")
}

function resolveAppServerTimeoutMs(env: RuntimeEnv): number {
  const parsed = Number.parseInt(env["OMO_SPARKSHELL_APP_SERVER_TIMEOUT_MS"]?.trim() ?? "", 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 5000
}

class JsonRpcSparkShellAppServerClient implements SparkShellAppServerClient {
  readonly #socketPath: string
  readonly #timeoutMs: number
  #platform: NodeJS.Platform | null = null

  constructor(socketPath: string, timeoutMs: number) {
    this.#socketPath = socketPath
    this.#timeoutMs = timeoutMs
  }

  async getPlatform(): Promise<NodeJS.Platform> {
    if (this.#platform) {
      return this.#platform
    }
    const connection = await this.#openInitializedConnection()
    connection.socket.destroy()
    return mapAppServerPlatform(connection.initialize)
  }

  async exec(command: SparkShellAppServerCommand): Promise<SparkShellAppServerResult> {
    const connection = await this.#openInitializedConnection()
    try {
      const result = parseCommandExecResult(await this.#request(connection.socket, "command/exec", {
        command: command.argv,
        cwd: command.cwd,
        env: command.env,
        tty: false,
        streamStdin: false,
        streamStdoutStderr: false,
      }))
      return {
        exitCode: typeof result.exitCode === "number" ? result.exitCode : 1,
        stdout: typeof result.stdout === "string" ? result.stdout : "",
        stderr: typeof result.stderr === "string" ? result.stderr : "",
      }
    } finally {
      connection.socket.destroy()
    }
  }

  async #openInitializedConnection(): Promise<{ readonly socket: Socket; readonly initialize: InitializeResult }> {
    const socket = await connectUnixWebSocket(this.#socketPath)
    try {
      const initialize = parseInitializeResult(await this.#request(socket, "initialize", {
        clientInfo: { name: "omo-sparkshell", version: "0.0.0" },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
          optOutNotificationMethods: [],
        },
      }))
      this.#platform = mapAppServerPlatform(initialize)
      writeWebSocketText(socket, JSON.stringify({ method: "initialized" }))
      return { socket, initialize }
    } catch (error) {
      socket.destroy()
      throw error
    }
  }

  async #request(socket: Socket, method: string, params: unknown): Promise<unknown> {
    const id = `${method}-${Date.now()}-${Math.random().toString(16).slice(2)}`
    writeWebSocketText(socket, JSON.stringify({ method, id, params }))
    for (;;) {
      const text = await withTimeout(readWebSocketText(socket), this.#timeoutMs, method)
      const parsed = parseJsonRpcResponse(text)
      if (parsed.kind === "other") {
        continue
      }
      const response = parsed.response
      if (response.id !== id) {
        continue
      }
      if (response.error) {
        throw new Error(response.error.message || `appserver ${method} failed`)
      }
      return response.result
    }
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`appserver ${label} timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeout !== null) clearTimeout(timeout)
  }
}

function parseJsonRpcResponse(text: string): ParsedJsonRpcResponse {
  const parsed: unknown = JSON.parse(text)
  if (!isRecord(parsed)) {
    return { kind: "other" }
  }
  return {
    kind: "response",
    response: {
      id: parseResponseId(parsed["id"]),
      result: parsed["result"],
      error: parseResponseError(parsed["error"]),
    },
  }
}

function parseResponseId(value: unknown): string | number | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined
}

function parseResponseError(value: unknown): { readonly message?: string } | undefined {
  if (!isRecord(value)) {
    return undefined
  }
  const message = value["message"]
  return { message: typeof message === "string" ? message : undefined }
}



function parseInitializeResult(value: unknown): InitializeResult {
  if (!isRecord(value)) {
    return {}
  }
  return {
    platformOs: typeof value["platformOs"] === "string" ? value["platformOs"] : undefined,
    platformFamily: typeof value["platformFamily"] === "string" ? value["platformFamily"] : undefined,
  }
}

function parseCommandExecResult(value: unknown): CommandExecResult {
  if (!isRecord(value)) {
    return {}
  }
  return {
    exitCode: typeof value["exitCode"] === "number" ? value["exitCode"] : undefined,
    stdout: typeof value["stdout"] === "string" ? value["stdout"] : undefined,
    stderr: typeof value["stderr"] === "string" ? value["stderr"] : undefined,
  }
}

function mapAppServerPlatform(result: InitializeResult): NodeJS.Platform {
  if (result.platformOs === "windows" || result.platformFamily === "windows") {
    return "win32"
  }
  if (result.platformOs === "macos") {
    return "darwin"
  }
  return "linux"
}
