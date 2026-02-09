import { Readable, Writable } from "node:stream"
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node"
import type { Diagnostic, ResolvedServer } from "./types"
import { spawnProcess, type UnifiedProcess } from "./lsp-process"
import { log } from "../../shared/logger"
export class LSPClientTransport {
  protected proc: UnifiedProcess | null = null
  protected connection: MessageConnection | null = null
  protected readonly stderrBuffer: string[] = []
  protected processExited = false
  protected readonly diagnosticsStore = new Map<string, Diagnostic[]>()
  protected readonly REQUEST_TIMEOUT = 15000

  constructor(protected root: string, protected server: ResolvedServer) {}
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
      throw new Error(`LSP server exited immediately with code ${this.proc.exitCode}` + (stderr ? `\nstderr: ${stderr}` : ""))
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

    this.connection = createMessageConnection(new StreamMessageReader(nodeReadable), new StreamMessageWriter(nodeWritable))

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

  protected startStderrReading(): void {
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

  protected async sendRequest<T>(method: string, params?: unknown): Promise<T> {
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

  protected sendNotification(method: string, params?: unknown): void {
    if (!this.connection) return
    if (this.processExited || (this.proc && this.proc.exitCode !== null)) return
    this.connection.sendNotification(method, params)
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
          proc.exited.then(() => {
            exitedBeforeTimeout = true
          }).finally(() => timeoutId && clearTimeout(timeoutId)),
          timeoutPromise,
        ])
        if (!exitedBeforeTimeout) {
          log("[LSPClient] Process did not exit within timeout, escalating to SIGKILL")
          try {
            proc.kill("SIGKILL")
            // Wait briefly for SIGKILL to take effect
            await Promise.race([proc.exited, new Promise<void>((resolve) => setTimeout(resolve, 1000))])
          } catch {}
        }
      } catch {}
    }
    this.processExited = true
    this.diagnosticsStore.clear()
  }
}
