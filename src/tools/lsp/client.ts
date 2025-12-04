import { spawn, type Subprocess } from "bun"
import { readFileSync } from "fs"
import { extname, resolve } from "path"
import type { ResolvedServer } from "./config"
import { getLanguageId } from "./config"

export class LSPClient {
  private proc: Subprocess<"pipe", "pipe", "pipe"> | null = null
  private buffer: Uint8Array = new Uint8Array(0)
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private requestId = 0
  private openedFiles = new Set<string>()

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
    this.startReading()
  }

  private startReading(): void {
    if (!this.proc) return

    const reader = this.proc.stdout.getReader()
    const read = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const newBuf = new Uint8Array(this.buffer.length + value.length)
          newBuf.set(this.buffer)
          newBuf.set(value, this.buffer.length)
          this.buffer = newBuf
          this.processBuffer()
        }
      } catch {
      }
    }
    read()
  }

  private findSequence(haystack: Uint8Array, needle: number[]): number {
    outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) {
        if (haystack[i + j] !== needle[j]) continue outer
      }
      return i
    }
    return -1
  }

  private processBuffer(): void {
    const decoder = new TextDecoder()
    const CONTENT_LENGTH = [67, 111, 110, 116, 101, 110, 116, 45, 76, 101, 110, 103, 116, 104, 58]
    const CRLF_CRLF = [13, 10, 13, 10]
    const LF_LF = [10, 10]

    while (true) {
      const headerStart = this.findSequence(this.buffer, CONTENT_LENGTH)
      if (headerStart === -1) break
      if (headerStart > 0) this.buffer = this.buffer.slice(headerStart)

      let headerEnd = this.findSequence(this.buffer, CRLF_CRLF)
      let sepLen = 4
      if (headerEnd === -1) {
        headerEnd = this.findSequence(this.buffer, LF_LF)
        sepLen = 2
      }
      if (headerEnd === -1) break

      const header = decoder.decode(this.buffer.slice(0, headerEnd))
      const match = header.match(/Content-Length:\s*(\d+)/i)
      if (!match) break

      const len = parseInt(match[1], 10)
      const start = headerEnd + sepLen
      const end = start + len
      if (this.buffer.length < end) break

      const content = decoder.decode(this.buffer.slice(start, end))
      this.buffer = this.buffer.slice(end)

      try {
        const msg = JSON.parse(content)

        // Handle server requests (has id AND method) - e.g., workspace/configuration
        if ("id" in msg && "method" in msg) {
          this.handleServerRequest(msg.id, msg.method, msg.params)
        }
        // Handle server responses (has id, no method)
        else if ("id" in msg && this.pending.has(msg.id)) {
          const handler = this.pending.get(msg.id)!
          this.pending.delete(msg.id)
          if ("error" in msg) {
            handler.reject(new Error(msg.error.message))
          } else {
            handler.resolve(msg.result)
          }
        }
      } catch {
      }
    }
  }

  private send(method: string, params?: unknown): Promise<unknown> {
    if (!this.proc) throw new Error("LSP client not started")

    const id = ++this.requestId
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params })
    const header = `Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n`
    this.proc.stdin.write(header + msg)

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error("LSP request timeout"))
        }
      }, 30000)
    })
  }

  private notify(method: string, params?: unknown): void {
    if (!this.proc) return

    const msg = JSON.stringify({ jsonrpc: "2.0", method, params })
    this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`)
  }

  private respond(id: number | string, result: unknown): void {
    if (!this.proc) return

    const msg = JSON.stringify({ jsonrpc: "2.0", id, result })
    this.proc.stdin.write(`Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`)
  }

  private handleServerRequest(id: number | string, method: string, _params?: unknown): void {
    if (method === "workspace/configuration") {
      this.respond(id, [{}])
    } else if (method === "client/registerCapability") {
      this.respond(id, null)
    } else if (method === "window/workDoneProgress/create") {
      this.respond(id, null)
    }
  }

  async initialize(): Promise<void> {
    const rootUri = `file://${this.root}`
    await this.send("initialize", {
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
        },
        workspace: {
          symbol: {},
          workspaceFolders: true,
          configuration: true,
        },
      },
      ...this.server.initialization,
    })
    this.notify("initialized")
    this.notify("workspace/didChangeConfiguration", { settings: {} })
    await new Promise((r) => setTimeout(r, 500))
  }

  async openFile(filePath: string): Promise<void> {
    const absPath = resolve(filePath)
    if (this.openedFiles.has(absPath)) return

    const text = readFileSync(absPath, "utf-8")
    const ext = extname(absPath)
    const languageId = getLanguageId(ext)

    this.notify("textDocument/didOpen", {
      textDocument: {
        uri: `file://${absPath}`,
        languageId,
        version: 1,
        text,
      },
    })
    this.openedFiles.add(absPath)

    await new Promise((r) => setTimeout(r, 2000))
  }

  async hover(filePath: string, line: number, character: number): Promise<unknown> {
    const absPath = resolve(filePath)
    await this.openFile(absPath)
    return this.send("textDocument/hover", {
      textDocument: { uri: `file://${absPath}` },
      position: { line: line - 1, character },
    })
  }

  async definition(filePath: string, line: number, character: number): Promise<unknown> {
    const absPath = resolve(filePath)
    await this.openFile(absPath)
    return this.send("textDocument/definition", {
      textDocument: { uri: `file://${absPath}` },
      position: { line: line - 1, character },
    })
  }

  async references(filePath: string, line: number, character: number, includeDeclaration = true): Promise<unknown> {
    const absPath = resolve(filePath)
    await this.openFile(absPath)
    return this.send("textDocument/references", {
      textDocument: { uri: `file://${absPath}` },
      position: { line: line - 1, character },
      context: { includeDeclaration },
    })
  }

  async documentSymbols(filePath: string): Promise<unknown> {
    const absPath = resolve(filePath)
    await this.openFile(absPath)
    return this.send("textDocument/documentSymbol", {
      textDocument: { uri: `file://${absPath}` },
    })
  }

  async workspaceSymbols(query: string): Promise<unknown> {
    return this.send("workspace/symbol", { query })
  }

  async diagnostics(filePath: string): Promise<unknown> {
    const absPath = resolve(filePath)
    await this.openFile(absPath)
    await new Promise((r) => setTimeout(r, 1000))
    return this.send("textDocument/diagnostic", {
      textDocument: { uri: `file://${absPath}` },
    })
  }

  async stop(): Promise<void> {
    try {
      await this.send("shutdown", {})
      this.notify("exit")
    } catch {
    }
    this.proc?.kill()
    this.proc = null
  }
}
