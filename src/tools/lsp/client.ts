import { spawn as bunSpawn, type Subprocess } from "bun"
import { spawn as nodeSpawn, spawnSync, type ChildProcess } from "node:child_process"
import { Readable, Writable } from "node:stream"
import { existsSync, readFileSync, statSync } from "fs"
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

// Bun spawn segfaults on Windows (oven-sh/bun#25798) — unfixed as of v1.3.8+
function shouldUseNodeSpawn(): boolean {
  return process.platform === "win32"
}

// Prevents segfaults when libuv gets a non-existent cwd (oven-sh/bun#25798)
export function validateCwd(cwd: string): { valid: boolean; error?: string } {
  try {
    if (!existsSync(cwd)) {
      return { valid: false, error: `Working directory does not exist: ${cwd}` }
    }
    const stats = statSync(cwd)
    if (!stats.isDirectory()) {
      return { valid: false, error: `Path is not a directory: ${cwd}` }
    }
    return { valid: true }
  } catch (err) {
    return { valid: false, error: `Cannot access working directory: ${cwd} (${err instanceof Error ? err.message : String(err)})` }
  }
}

function isBinaryAvailableOnWindows(command: string): boolean {
  if (process.platform !== "win32") return true

  if (command.includes("/") || command.includes("\\")) {
    return existsSync(command)
  }

  try {
    const result = spawnSync("where", [command], {
      shell: true,
      windowsHide: true,
      timeout: 5000,
    })
    return result.status === 0
  } catch {
    return true
  }
}

interface StreamReader {
  read(): Promise<{ done: boolean; value: Uint8Array | undefined }>
}

// Bridges Bun Subprocess and Node.js ChildProcess under a common API
interface UnifiedProcess {
  stdin: { write(chunk: Uint8Array | string): void }
  stdout: { getReader(): StreamReader }
  stderr: { getReader(): StreamReader }
  exitCode: number | null
  exited: Promise<number>
  kill(signal?: string): void
}

function wrapNodeProcess(proc: ChildProcess): UnifiedProcess {
  let resolveExited: (code: number) => void
  let exitCode: number | null = null

  const exitedPromise = new Promise<number>((resolve) => {
    resolveExited = resolve
  })

  proc.on("exit", (code) => {
    exitCode = code ?? 1
    resolveExited(exitCode)
  })

  proc.on("error", () => {
    if (exitCode === null) {
      exitCode = 1
      resolveExited(1)
    }
  })

  const createStreamReader = (nodeStream: NodeJS.ReadableStream | null): StreamReader => {
    const chunks: Uint8Array[] = []
    let streamEnded = false
    type ReadResult = { done: boolean; value: Uint8Array | undefined }
    let waitingResolve: ((result: ReadResult) => void) | null = null

    if (nodeStream) {
      nodeStream.on("data", (chunk: Buffer) => {
        const uint8 = new Uint8Array(chunk)
        if (waitingResolve) {
          const resolve = waitingResolve
          waitingResolve = null
          resolve({ done: false, value: uint8 })
        } else {
          chunks.push(uint8)
        }
      })

      nodeStream.on("end", () => {
        streamEnded = true
        if (waitingResolve) {
          const resolve = waitingResolve
          waitingResolve = null
          resolve({ done: true, value: undefined })
        }
      })

      nodeStream.on("error", () => {
        streamEnded = true
        if (waitingResolve) {
          const resolve = waitingResolve
          waitingResolve = null
          resolve({ done: true, value: undefined })
        }
      })
    } else {
      streamEnded = true
    }

    return {
      read(): Promise<ReadResult> {
        return new Promise((resolve) => {
          if (chunks.length > 0) {
            resolve({ done: false, value: chunks.shift()! })
          } else if (streamEnded) {
            resolve({ done: true, value: undefined })
          } else {
            waitingResolve = resolve
          }
        })
      },
    }
  }

  return {
    stdin: {
      write(chunk: Uint8Array | string) {
        if (proc.stdin) {
          proc.stdin.write(chunk)
        }
      },
    },
    stdout: {
      getReader: () => createStreamReader(proc.stdout),
    },
    stderr: {
      getReader: () => createStreamReader(proc.stderr),
    },
    get exitCode() {
      return exitCode
    },
    exited: exitedPromise,
    kill(signal?: string) {
      try {
        if (signal === "SIGKILL") {
          proc.kill("SIGKILL")
        } else {
          proc.kill()
        }
      } catch {}
    },
  }
}

function spawnProcess(
  command: string[],
  options: { cwd: string; env: Record<string, string | undefined> }
): UnifiedProcess {
  const cwdValidation = validateCwd(options.cwd)
  if (!cwdValidation.valid) {
    throw new Error(`[LSP] ${cwdValidation.error}`)
  }

  if (shouldUseNodeSpawn()) {
    const [cmd, ...args] = command

    if (!isBinaryAvailableOnWindows(cmd)) {
      throw new Error(
        `[LSP] Binary '${cmd}' not found on Windows. ` +
        `Ensure the LSP server is installed and available in PATH. ` +
        `For npm packages, try: npm install -g ${cmd}`
      )
    }

    log("[LSP] Using Node.js child_process on Windows to avoid Bun spawn segfault")

    const proc = nodeSpawn(cmd, args, {
      cwd: options.cwd,
      env: options.env as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: true,
    })
    return wrapNodeProcess(proc)
  }

  const proc = bunSpawn(command, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    cwd: options.cwd,
    env: options.env,
  })

  return proc as unknown as UnifiedProcess
}

interface ManagedClient {
  client: LSPClient
  lastUsedAt: number
  refCount: number
  initPromise?: Promise<void>
  isInitializing: boolean
  initializingSince?: number
}

class LSPServerManager {
  private static instance: LSPServerManager
  private clients = new Map<string, ManagedClient>()
  private cleanupInterval: ReturnType<typeof setInterval> | null = null
  private readonly IDLE_TIMEOUT = 5 * 60 * 1000
  private readonly INIT_TIMEOUT = 60 * 1000

  private constructor() {
    this.startCleanupTimer()
    this.registerProcessCleanup()
  }

  private registerProcessCleanup(): void {
    // Synchronous cleanup for 'exit' event (cannot await)
    const syncCleanup = () => {
      for (const [, managed] of this.clients) {
        try {
          // Fire-and-forget during sync exit - process is terminating
          void managed.client.stop().catch(() => {})
        } catch {}
      }
      this.clients.clear()
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval)
        this.cleanupInterval = null
      }
    }

    // Async cleanup for signal handlers - properly await all stops
    const asyncCleanup = async () => {
      const stopPromises: Promise<void>[] = []
      for (const [, managed] of this.clients) {
        stopPromises.push(managed.client.stop().catch(() => {}))
      }
      await Promise.allSettled(stopPromises)
      this.clients.clear()
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval)
        this.cleanupInterval = null
      }
    }

    process.on("exit", syncCleanup)

    // Don't call process.exit() here - let other handlers complete their cleanup first
    // The background-agent manager handles the final exit call
    // Use async handlers to properly await LSP subprocess cleanup
    process.on("SIGINT", () => void asyncCleanup().catch(() => {}))
    process.on("SIGTERM", () => void asyncCleanup().catch(() => {}))

    if (process.platform === "win32") {
      process.on("SIGBREAK", () => void asyncCleanup().catch(() => {}))
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
      const now = Date.now()
      if (managed.isInitializing && managed.initializingSince !== undefined && now - managed.initializingSince >= this.INIT_TIMEOUT) {
        // Stale init can permanently block subsequent calls (e.g., LSP process hang)
        try {
          await managed.client.stop()
        } catch {}
        this.clients.delete(key)
        managed = undefined
      }
    }

    if (managed) {
      if (managed.initPromise) {
        try {
          await managed.initPromise
        } catch {
          // Failed init should not keep the key blocked forever.
          try {
            await managed.client.stop()
          } catch {}
          this.clients.delete(key)
          managed = undefined
        }
      }

      if (managed) {
        if (managed.client.isAlive()) {
          managed.refCount++
          managed.lastUsedAt = Date.now()
          return managed.client
        }
        try {
          await managed.client.stop()
        } catch {}
        this.clients.delete(key)
      }
    }

    const client = new LSPClient(root, server)
    const initPromise = (async () => {
      await client.start()
      await client.initialize()
    })()

    const initStartedAt = Date.now()
    this.clients.set(key, {
      client,
      lastUsedAt: initStartedAt,
      refCount: 1,
      initPromise,
      isInitializing: true,
      initializingSince: initStartedAt,
    })

    try {
      await initPromise
    } catch (error) {
      this.clients.delete(key)
      try {
        await client.stop()
      } catch {}
      throw error
    }
    const m = this.clients.get(key)
    if (m) {
      m.initPromise = undefined
      m.isInitializing = false
      m.initializingSince = undefined
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

    const initStartedAt = Date.now()
    this.clients.set(key, {
      client,
      lastUsedAt: initStartedAt,
      refCount: 0,
      initPromise,
      isInitializing: true,
      initializingSince: initStartedAt,
    })

    initPromise
      .then(() => {
        const m = this.clients.get(key)
        if (m) {
          m.initPromise = undefined
          m.isInitializing = false
          m.initializingSince = undefined
        }
      })
      .catch(() => {
        // Warmup failures must not permanently block future initialization.
        this.clients.delete(key)
        void client.stop().catch(() => {})
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
  private proc: UnifiedProcess | null = null
  private connection: MessageConnection | null = null
  private openedFiles = new Set<string>()
  private documentVersions = new Map<string, number>()
  private lastSyncedText = new Map<string, string>()
  private stderrBuffer: string[] = []
  private processExited = false
  private diagnosticsStore = new Map<string, Diagnostic[]>()
  private readonly REQUEST_TIMEOUT = 15000

  constructor(
    private root: string,
    private server: ResolvedServer
  ) {}

  async start(): Promise<void> {
    this.proc = spawnProcess(this.server.command, {
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
          if (done || !value) {
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

    const uri = pathToFileURL(absPath).href
    const text = readFileSync(absPath, "utf-8")

    if (!this.openedFiles.has(absPath)) {
      const ext = extname(absPath)
      const languageId = getLanguageId(ext)
      const version = 1

      this.sendNotification("textDocument/didOpen", {
        textDocument: {
          uri,
          languageId,
          version,
          text,
        },
      })

      this.openedFiles.add(absPath)
      this.documentVersions.set(uri, version)
      this.lastSyncedText.set(uri, text)
      await new Promise((r) => setTimeout(r, 1000))
      return
    }

    const prevText = this.lastSyncedText.get(uri)
    if (prevText === text) {
      return
    }

    const nextVersion = (this.documentVersions.get(uri) ?? 1) + 1
    this.documentVersions.set(uri, nextVersion)
    this.lastSyncedText.set(uri, text)

    this.sendNotification("textDocument/didChange", {
      textDocument: { uri, version: nextVersion },
      contentChanges: [{ text }],
    })

    // Some servers update diagnostics only after save
    this.sendNotification("textDocument/didSave", {
      textDocument: { uri },
      text,
    })
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
    const proc = this.proc
    if (proc) {
      this.proc = null
      let exitedBeforeTimeout = false
      try {
        proc.kill()
        // Wait for exit with timeout to prevent indefinite hang
        let timeoutId: ReturnType<typeof setTimeout> | undefined
        const timeoutPromise = new Promise<void>((resolve) => {
          timeoutId = setTimeout(resolve, 5000)
        })
        await Promise.race([
          proc.exited.then(() => { exitedBeforeTimeout = true }).finally(() => timeoutId && clearTimeout(timeoutId)),
          timeoutPromise,
        ])
        if (!exitedBeforeTimeout) {
          log("[LSPClient] Process did not exit within timeout, escalating to SIGKILL")
          try {
            proc.kill("SIGKILL")
            // Wait briefly for SIGKILL to take effect
            await Promise.race([
              proc.exited,
              new Promise<void>((resolve) => setTimeout(resolve, 1000)),
            ])
          } catch {}
        }
      } catch {}
    }
    this.processExited = true
    this.diagnosticsStore.clear()
  }
}
