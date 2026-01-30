import { spawn, type Subprocess } from "bun"
import { Readable, Writable } from "node:stream"
import { readFileSync } from "fs"
import { extname, resolve } from "path"
import { pathToFileURL } from "node:url"
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node"
import { getLanguageId } from "./config"
import type { Diagnostic, ResolvedServer } from "./types"
import { log } from "../../shared/logger"

interface ManagedClient {
  client: LSPClient
  lastUsedAt: number
  refCount: number
  initPromise?: Promise<void>
  isInitializing: boolean
}

class LSPServerManager {
  private static instance: LSPServerManager
  private clients = new Map<string, ManagedClient>()
  private cleanupInterval: ReturnType<typeof setInterval> | null = null
  private readonly IDLE_TIMEOUT = 5 * 60 * 1000

  private constructor() {
    this.startCleanupTimer()
    this.registerProcessCleanup()
  }

  private registerProcessCleanup(): void {
    const cleanup = () => {
      for (const [, managed] of this.clients) {
        try {
          managed.client.stop()
        } catch {}
      }
      this.clients.clear()
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval)
        this.cleanupInterval = null
      }
    }

    process.on("exit", cleanup)

    process.on("SIGINT", () => {
      cleanup()
      process.exit(0)
    })

    process.on("SIGTERM", () => {
      cleanup()
      process.exit(0)
    })

    if (process.platform === "win32") {
      process.on("SIGBREAK", () => {
        cleanup()
        process.exit(0)
      })
    }
  }

  static getInstance(): LSPServerManager {
    if (!LSPServerManager.instance) {
      LSPServerManager.instance = new LSPServerManager()
    }
    return LSPServerManager.instance
  }

  private getKey(root: string, serverId: string): string {
    return `${root}::${serverId}`
  }

  private startCleanupTimer(): void {
    if (this.cleanupInterval) return
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleClients()
    }, 60000)
  }

  private cleanupIdleClients(): void {
    const now = Date.now()
    for (const [key, managed] of this.clients) {
      if (managed.refCount === 0 && now - managed.lastUsedAt > this.IDLE_TIMEOUT) {
        managed.client.stop()
        this.clients.delete(key)
      }
    }
  }

  async getClient(root: string, server: ResolvedServer): Promise<LSPClient> {
    const key = this.getKey(root, server.id)

    let managed = this.clients.get(key)
    if (managed) {
      if (managed.initPromise) {
        await managed.initPromise
      }
      if (managed.client.isAlive()) {
        managed.refCount++
        managed.lastUsedAt = Date.now()
        return managed.client
      }
      await managed.client.stop()
      this.clients.delete(key)
    }

    const client = new LSPClient(root, server)
    const initPromise = (async () => {
      await client.start()
      await client.initialize()
    })()

    this.clients.set(key, {
      client,
      lastUsedAt: Date.now(),
      refCount: 1,
      initPromise,
      isInitializing: true,
    })

    await initPromise
    const m = this.clients.get(key)
    if (m) {
      m.initPromise = undefined
      m.isInitializing = false
    }

    return client
  }

  warmupClient(root: string, server: ResolvedServer): void {
    const key = this.getKey(root, server.id)
    if (this.clients.has(key)) return

    const client = new LSPClient(root, server)
    const initPromise = (async () => {
      await client.start()
      await client.initialize()
    })()

    this.clients.set(key, {
      client,
      lastUsedAt: Date.now(),
      refCount: 0,
      initPromise,
      isInitializing: true,
    })

    initPromise.then(() => {
      const m = this.clients.get(key)
      if (m) {
        m.initPromise = undefined
        m.isInitializing = false
      }
    })
  }

  releaseClient(root: string, serverId: string): void {
    const key = this.getKey(root, serverId)
    const managed = this.clients.get(key)
    if (managed && managed.refCount > 0) {
      managed.refCount--
      managed.lastUsedAt = Date.now()
    }
  }

  isServerInitializing(root: string, serverId: string): boolean {
    const key = this.getKey(root, serverId)
    const managed = this.clients.get(key)
    return managed?.isInitializing ?? false
  }

  async stopAll(): Promise<void> {
    for (const [, managed] of this.clients) {
      await managed.client.stop()
    }
    this.clients.clear()
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  async cleanupTempDirectoryClients(): Promise<void> {
    const keysToRemove: string[] = []
    for (const [key, managed] of this.clients.entries()) {
      const isTempDir = key.startsWith("/tmp/") || key.startsWith("/var/folders/")
      const isIdle = managed.refCount === 0
      if (isTempDir && isIdle) {
        keysToRemove.push(key)
      }
    }
    for (const key of keysToRemove) {
      const managed = this.clients.get(key)
      if (managed) {
        this.clients.delete(key)
        try {
          await managed.client.stop()
        } catch {}
      }
    }
  }
}

export const lspManager = LSPServerManager.getInstance()

export class LSPClient {
  private proc: Subprocess<"pipe", "pipe", "pipe"> | null = null
  private connection: MessageConnection | null = null
  private openedFiles = new Set<string>()
  private stderrBuffer: string[] = []
  private processExited = false
  private diagnosticsStore = new Map<string, Diagnostic[]>()
  private readonly REQUEST_TIMEOUT = 15000

  constructor(
    private root: string,
    private server: ResolvedServer
  ) {}

  async start(): Promise<void> {
    this.proc = spawn(this.server.command, {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      cwd: this.root,
      env: {
        ...process.env,
        ...this.server.env,
      },
    })

    if (!this.proc) {
      throw new Error(`Failed to spawn LSP server: ${this.server.command.join(" ")}`)
    }

    this.startStderrReading()

    await new Promise((resolve) => setTimeout(resolve, 100))

    if (this.proc.exitCode !== null) {
      const stderr = this.stderrBuffer.join("\n")
      throw new Error(
        `LSP server exited immediately with code ${this.proc.exitCode}` + (stderr ? `\nstderr: ${stderr}` : "")
      )
    }

    const stdoutReader = this.proc.stdout.getReader()
    const nodeReadable = new Readable({
      async read() {
        try {
          const { done, value } = await stdoutReader.read()
          if (done) {
            this.push(null)
          } else {
            this.push(Buffer.from(value))
          }
        } catch {
          this.push(null)
        }
      },
    })

    const stdin = this.proc.stdin
    const nodeWritable = new Writable({
      write(chunk, _encoding, callback) {
        try {
          stdin.write(chunk)
          callback()
        } catch (err) {
          callback(err as Error)
        }
      },
    })

    this.connection = createMessageConnection(
      new StreamMessageReader(nodeReadable),
      new StreamMessageWriter(nodeWritable)
    )

    this.connection.onNotification("textDocument/publishDiagnostics", (params: { uri?: string; diagnostics?: Diagnostic[] }) => {
      if (params.uri) {
        this.diagnosticsStore.set(params.uri, params.diagnostics ?? [])
      }
    })

    this.connection.onRequest("workspace/configuration", (params: { items?: Array<{ section?: string }> }) => {
      const items = params?.items ?? []
      return items.map((item) => {
        if (item.section === "json") return { validate: { enable: true } }
        return {}
      })
    })

    this.connection.onRequest("client/registerCapability", () => null)
    this.connection.onRequest("window/workDoneProgress/create", () => null)

    this.connection.onClose(() => {
      this.processExited = true
    })

    this.connection.onError((error) => {
      log("LSP connection error:", error)
    })

    this.connection.listen()
  }

  private startStderrReading(): void {
    if (!this.proc) return

    const reader = this.proc.stderr.getReader()
    const read = async () => {
      const decoder = new TextDecoder()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const text = decoder.decode(value)
          this.stderrBuffer.push(text)
          if (this.stderrBuffer.length > 100) {
            this.stderrBuffer.shift()
          }
        }
      } catch {}
    }
    read()
  }

  private async sendRequest<T>(method: string, params?: unknown): Promise<T> {
    if (!this.connection) throw new Error("LSP client not started")

    if (this.processExited || (this.proc && this.proc.exitCode !== null)) {
      const stderr = this.stderrBuffer.slice(-10).join("\n")
      throw new Error(`LSP server already exited (code: ${this.proc?.exitCode})` + (stderr ? `\nstderr: ${stderr}` : ""))
    }

    let timeoutId: ReturnType<typeof setTimeout>
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        const stderr = this.stderrBuffer.slice(-5).join("\n")
        reject(new Error(`LSP request timeout (method: ${method})` + (stderr ? `\nrecent stderr: ${stderr}` : "")))
      }, this.REQUEST_TIMEOUT)
    })

    const requestPromise = this.connection.sendRequest(method, params) as Promise<T>

    try {
      const result = await Promise.race([requestPromise, timeoutPromise])
      clearTimeout(timeoutId!)
      return result
    } catch (error) {
      clearTimeout(timeoutId!)
      throw error
    }
  }

  private sendNotification(method: string, params?: unknown): void {
    if (!this.connection) return
    if (this.processExited || (this.proc && this.proc.exitCode !== null)) return

    this.connection.sendNotification(method, params)
  }

  async initialize(): Promise<void> {
    const rootUri = pathToFileURL(this.root).href
    await this.sendRequest("initialize", {
      processId: process.pid,
      rootUri,
      rootPath: this.root,
      workspaceFolders: [{ uri: rootUri, name: "workspace" }],
      capabilities: {
        textDocument: {
          hover: { contentFormat: ["markdown", "plaintext"] },
          definition: { linkSupport: true },
          references: {},
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          publishDiagnostics: {},
          rename: {
            prepareSupport: true,
            prepareSupportDefaultBehavior: 1,
            honorsChangeAnnotations: true,
          },
          codeAction: {
            codeActionLiteralSupport: {
              codeActionKind: {
                valueSet: [
                  "quickfix",
                  "refactor",
                  "refactor.extract",
                  "refactor.inline",
                  "refactor.rewrite",
                  "source",
                  "source.organizeImports",
                  "source.fixAll",
                ],
              },
            },
            isPreferredSupport: true,
            disabledSupport: true,
            dataSupport: true,
            resolveSupport: {
              properties: ["edit", "command"],
            },
          },
        },
        workspace: {
          symbol: {},
          workspaceFolders: true,
          configuration: true,
          applyEdit: true,
          workspaceEdit: {
            documentChanges: true,
          },
        },
      },
      ...this.server.initialization,
    })
    this.sendNotification("initialized")
    this.sendNotification("workspace/didChangeConfiguration", {
      settings: { json: { validate: { enable: true } } },
    })
    await new Promise((r) => setTimeout(r, 300))
  }

  async openFile(filePath: string): Promise<void> {
    const absPath = resolve(filePath)
    if (this.openedFiles.has(absPath)) return

    const text = readFileSync(absPath, "utf-8")
    const ext = extname(absPath)
    const languageId = getLanguageId(ext)

    this.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri: pathToFileURL(absPath).href,
        languageId,
        version: 1,
        text,
      },
    })
    this.openedFiles.add(absPath)

    await new Promise((r) => setTimeout(r, 1000))
  }

  async definition(filePath: string, line: number, character: number): Promise<unknown> {
    const absPath = resolve(filePath)
    await this.openFile(absPath)
    return this.sendRequest("textDocument/definition", {
      textDocument: { uri: pathToFileURL(absPath).href },
      position: { line: line - 1, character },
    })
  }

  async references(filePath: string, line: number, character: number, includeDeclaration = true): Promise<unknown> {
    const absPath = resolve(filePath)
    await this.openFile(absPath)
    return this.sendRequest("textDocument/references", {
      textDocument: { uri: pathToFileURL(absPath).href },
      position: { line: line - 1, character },
      context: { includeDeclaration },
    })
  }

  async documentSymbols(filePath: string): Promise<unknown> {
    const absPath = resolve(filePath)
    await this.openFile(absPath)
    return this.sendRequest("textDocument/documentSymbol", {
      textDocument: { uri: pathToFileURL(absPath).href },
    })
  }

  async workspaceSymbols(query: string): Promise<unknown> {
    return this.sendRequest("workspace/symbol", { query })
  }

  async diagnostics(filePath: string): Promise<{ items: Diagnostic[] }> {
    const absPath = resolve(filePath)
    const uri = pathToFileURL(absPath).href
    await this.openFile(absPath)
    await new Promise((r) => setTimeout(r, 500))

    try {
      const result = await this.sendRequest<{ items?: Diagnostic[] }>("textDocument/diagnostic", {
        textDocument: { uri },
      })
      if (result && typeof result === "object" && "items" in result) {
        return result as { items: Diagnostic[] }
      }
    } catch {}

    return { items: this.diagnosticsStore.get(uri) ?? [] }
  }

  async prepareRename(filePath: string, line: number, character: number): Promise<unknown> {
    const absPath = resolve(filePath)
    await this.openFile(absPath)
    return this.sendRequest("textDocument/prepareRename", {
      textDocument: { uri: pathToFileURL(absPath).href },
      position: { line: line - 1, character },
    })
  }

  async rename(filePath: string, line: number, character: number, newName: string): Promise<unknown> {
    const absPath = resolve(filePath)
    await this.openFile(absPath)
    return this.sendRequest("textDocument/rename", {
      textDocument: { uri: pathToFileURL(absPath).href },
      position: { line: line - 1, character },
      newName,
    })
  }

  isAlive(): boolean {
    return this.proc !== null && !this.processExited && this.proc.exitCode === null
  }

  async stop(): Promise<void> {
    if (this.connection) {
      try {
        this.sendNotification("shutdown", {})
        this.sendNotification("exit")
      } catch {}
      this.connection.dispose()
      this.connection = null
    }
    this.proc?.kill()
    this.proc = null
    this.processExited = true
    this.diagnosticsStore.clear()
  }
}
