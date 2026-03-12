import { createServer, connect, type Server, type Socket } from "net"
import { createHash } from "crypto"
import { existsSync, mkdirSync, unlinkSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import type { ILSPClient, Diagnostic, ResolvedServer, IPCRequest, IPCResponse } from "./types"

const SOCKET_DIR = join(tmpdir(), "omc-lsp")
const CONNECTION_TIMEOUT = 3000
const REQUEST_TIMEOUT = 15000
const IDLE_SHUTDOWN_MS = 5 * 60 * 1000

function ensureSocketDir(): void {
  if (!existsSync(SOCKET_DIR)) {
    mkdirSync(SOCKET_DIR, { recursive: true })
  }
}

export function getSocketPath(root: string, serverId: string): string {
  const hash = createHash("sha256").update(`${root}::${serverId}`).digest("hex").slice(0, 16)
  return join(SOCKET_DIR, `${hash}.sock`)
}

export class LSPSharedServer {
  private server: Server | null = null
  private clients = new Set<Socket>()
  private socketPath: string
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    root: string,
    serverConfig: ResolvedServer,
    private lspClient: ILSPClient
  ) {
    this.socketPath = getSocketPath(root, serverConfig.id)
  }

  async start(): Promise<void> {
    ensureSocketDir()

    if (existsSync(this.socketPath)) {
      try {
        unlinkSync(this.socketPath)
      } catch {}
    }

    return new Promise((resolve, reject) => {
      this.server = createServer((socket) => this.onConnection(socket))

      this.server.on("error", (err) => {
        const code = (err as NodeJS.ErrnoException).code
        reject(code === "EADDRINUSE" ? new Error("EADDRINUSE") : err)
      })

      this.server.listen(this.socketPath, () => resolve())
    })
  }

  private onConnection(socket: Socket): void {
    this.clients.add(socket)
    this.clearIdleTimer()

    let buffer = ""

    socket.on("data", (data) => {
      buffer += data.toString()
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          this.handleRequest(socket, JSON.parse(line) as IPCRequest)
        } catch {}
      }
    })

    socket.on("close", () => {
      this.clients.delete(socket)
      if (this.clients.size === 0) this.startIdleTimer()
    })

    socket.on("error", () => this.clients.delete(socket))
  }

  private async handleRequest(socket: Socket, req: IPCRequest): Promise<void> {
    try {
      const p = req.params
      let result: unknown

      switch (req.method) {
        case "definition":
          result = await this.lspClient.definition(p.filePath as string, p.line as number, p.character as number)
          break
        case "references":
          result = await this.lspClient.references(
            p.filePath as string,
            p.line as number,
            p.character as number,
            (p.includeDeclaration as boolean) ?? true
          )
          break
        case "documentSymbols":
          result = await this.lspClient.documentSymbols(p.filePath as string)
          break
        case "workspaceSymbols":
          result = await this.lspClient.workspaceSymbols(p.query as string)
          break
        case "diagnostics":
          result = await this.lspClient.diagnostics(p.filePath as string)
          break
        case "prepareRename":
          result = await this.lspClient.prepareRename(p.filePath as string, p.line as number, p.character as number)
          break
        case "rename":
          result = await this.lspClient.rename(
            p.filePath as string,
            p.line as number,
            p.character as number,
            p.newName as string
          )
          break
        case "ping":
          result = "pong"
          break
        default:
          throw new Error(`Unknown method: ${req.method}`)
      }

      this.respond(socket, { id: req.id, result })
    } catch (err) {
      this.respond(socket, { id: req.id, error: err instanceof Error ? err.message : String(err) })
    }
  }

  private respond(socket: Socket, response: IPCResponse): void {
    try {
      socket.write(JSON.stringify(response) + "\n")
    } catch {}
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  private startIdleTimer(): void {
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => this.stop(), IDLE_SHUTDOWN_MS)
  }

  async stop(): Promise<void> {
    this.clearIdleTimer()
    for (const client of this.clients) {
      try {
        client.destroy()
      } catch {}
    }
    this.clients.clear()

    if (this.server) {
      this.server.close()
      this.server = null
    }

    try {
      unlinkSync(this.socketPath)
    } catch {}
  }

  isRunning(): boolean {
    return this.server !== null && this.server.listening
  }
}

export class LSPSharedClient implements ILSPClient {
  private socket: Socket | null = null
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private idCounter = 0
  private buffer = ""
  private connected = false

  constructor(private socketPath: string) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.connected) {
          socket.destroy()
          reject(new Error("Connection timeout"))
        }
      }, CONNECTION_TIMEOUT)

      const socket = connect(this.socketPath)

      socket.on("connect", () => {
        clearTimeout(timer)
        this.socket = socket
        this.connected = true
        this.startReading()
        resolve()
      })

      socket.on("error", (err) => {
        clearTimeout(timer)
        if (!this.connected) reject(err)
      })
    })
  }

  private startReading(): void {
    if (!this.socket) return

    this.socket.on("data", (data) => {
      this.buffer += data.toString()
      const lines = this.buffer.split("\n")
      this.buffer = lines.pop() ?? ""

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const res = JSON.parse(line) as IPCResponse
          const handler = this.pending.get(res.id)
          if (!handler) continue
          this.pending.delete(res.id)
          if (res.error) {
            handler.reject(new Error(res.error))
          } else {
            handler.resolve(res.result)
          }
        } catch {}
      }
    })

    this.socket.on("close", () => {
      this.connected = false
      for (const [, handler] of this.pending) {
        handler.reject(new Error("Shared LSP connection closed"))
      }
      this.pending.clear()
    })
  }

  private send(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.socket || !this.connected) {
      return Promise.reject(new Error("Not connected to shared LSP server"))
    }

    const id = ++this.idCounter
    const request: IPCRequest = { id, method, params }

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket!.write(JSON.stringify(request) + "\n")

      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`Shared LSP request timeout (method: ${method})`))
        }
      }, REQUEST_TIMEOUT)
    })
  }

  async definition(filePath: string, line: number, character: number): Promise<unknown> {
    return this.send("definition", { filePath, line, character })
  }

  async references(filePath: string, line: number, character: number, includeDeclaration = true): Promise<unknown> {
    return this.send("references", { filePath, line, character, includeDeclaration })
  }

  async documentSymbols(filePath: string): Promise<unknown> {
    return this.send("documentSymbols", { filePath })
  }

  async workspaceSymbols(query: string): Promise<unknown> {
    return this.send("workspaceSymbols", { query })
  }

  async diagnostics(filePath: string): Promise<{ items: Diagnostic[] }> {
    return this.send("diagnostics", { filePath }) as Promise<{ items: Diagnostic[] }>
  }

  async prepareRename(filePath: string, line: number, character: number): Promise<unknown> {
    return this.send("prepareRename", { filePath, line, character })
  }

  async rename(filePath: string, line: number, character: number, newName: string): Promise<unknown> {
    return this.send("rename", { filePath, line, character, newName })
  }

  // no-op: shared server handles file opening internally via the underlying LSPClient
  async openFile(_filePath: string): Promise<void> {}

  isAlive(): boolean {
    return this.connected
  }

  async stop(): Promise<void> {
    this.connected = false
    for (const [, handler] of this.pending) {
      handler.reject(new Error("Client stopped"))
    }
    this.pending.clear()
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
    }
  }
}

export async function tryConnectShared(root: string, serverId: string): Promise<LSPSharedClient | null> {
  const socketPath = getSocketPath(root, serverId)
  if (!existsSync(socketPath)) return null

  try {
    const client = new LSPSharedClient(socketPath)
    await client.connect()

    const pong = await client["send"]("ping", {})
    if (pong === "pong") return client

    await client.stop()
    return null
  } catch {
    try {
      unlinkSync(socketPath)
    } catch {}
    return null
  }
}

export async function startSharedServer(
  root: string,
  serverConfig: ResolvedServer,
  lspClient: ILSPClient
): Promise<LSPSharedServer | null> {
  try {
    const server = new LSPSharedServer(root, serverConfig, lspClient)
    await server.start()
    return server
  } catch {
    return null
  }
}
