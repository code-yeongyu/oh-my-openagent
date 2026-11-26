import { ChildProcess } from "node:child_process"
import { API } from "typescript/unstable/async"
import type { SourceFile } from "typescript/unstable/ast"

// The connection to the native API process is gone: vscode-jsonrpc's ConnectionErrors.Closed (1) or .Disposed (2), or a
// request whose write failed, which vscode-jsonrpc rejects as ResponseError MessageWriteError (-32099). The TypeScript
// API exports neither class, so both are matched by name and code. A failed write on this pipe can only mean the peer
// died.
const connectionGone = (error: unknown): boolean =>
  error instanceof Error &&
  "code" in error &&
  ((error.constructor.name === "ConnectionError" && (error.code === 1 || error.code === 2)) ||
    (error.constructor.name === "ResponseError" && error.code === -32099))

// The API keeps its native process private (API.client.process); read it at runtime and treat any other shape as
// unknown, which leaves the dead connection to connectionGone.
const nativeProcessOf = (api: API): ChildProcess | undefined => {
  const client: unknown = Reflect.get(api, "client")
  const child: unknown = typeof client === "object" && client !== null ? Reflect.get(client, "process") : undefined
  return child instanceof ChildProcess ? child : undefined
}

// Exited per this process (exit seen) or per the OS (the exit event may not have arrived yet; on Windows the pipe is
// not seen closed either, so the next write is the first sign of death).
const exited = (child: ChildProcess): boolean => {
  if (child.exitCode !== null || child.signalCode !== null) return true
  if (child.pid === undefined) return false
  try {
    process.kill(child.pid, 0)
    return false
  } catch {
    return true
  }
}

export class TypeScriptSourceParser {
  readonly #cwd: string
  #api: API
  #queue: Promise<unknown> = Promise.resolve()
  #closed = false

  constructor(cwd: string) {
    this.#cwd = cwd
    this.#api = new API({ cwd })
  }

  // One parse at a time. The TypeScript API starts its process on the first request without guarding concurrent first
  // requests (two would start two processes), and a restart must never close an API another parse is still using
  // (#13963 review L1). A parse whose process was killed fails at once, so it does not hold the queue.
  parse(filePaths: readonly string[]): Promise<ReadonlyMap<string, SourceFile>> {
    const run = this.#queue.then(async () => await this.#parseOrRestart(filePaths))
    this.#queue = run.catch(() => undefined)
    return run
  }

  // Queued behind the parses like them: a close issued while a parse restarts closes the API that parse ends with, and
  // a parse after close is refused instead of starting a new native process (#13963 review L1).
  close(): Promise<void> {
    const run = this.#queue.then(async () => {
      this.#closed = true
      await this.#api.close()
    })
    this.#queue = run.catch(() => undefined)
    return run
  }

  async #parseOrRestart(filePaths: readonly string[]): Promise<ReadonlyMap<string, SourceFile>> {
    if (this.#closed) throw new Error("TypeScriptSourceParser is closed")
    // A test that timed out has this process's children killed, the native API process among them (#13951): the next
    // parse starts a new one instead of failing on the dead connection. A process known to be gone is replaced before
    // anything is written to it: vscode-jsonrpc's sendRequest rejects a failed write as ResponseError and then re-throws
    // the raw write error (EPIPE) from an async promise executor nobody awaits, an unhandled rejection that fails the
    // caller even though the parse recovers (Windows junit run 44211405223).
    const child = nativeProcessOf(this.#api)
    if (child !== undefined && exited(child)) await this.#restart()
    try {
      return await this.#parseWith(this.#api, filePaths)
    } catch (error) {
      if (!connectionGone(error)) throw error
      await this.#restart()
      return await this.#parseWith(this.#api, filePaths)
    }
  }

  async #restart(): Promise<void> {
    await this.#api.close().catch(() => undefined)
    this.#api = new API({ cwd: this.#cwd })
  }

  async #parseWith(api: API, filePaths: readonly string[]): Promise<ReadonlyMap<string, SourceFile>> {
    const snapshot = await api.updateSnapshot({ openFiles: [...filePaths] })
    try {
      const sourceFiles = await Promise.all(
        filePaths.map(async (filePath) => {
          const project = await snapshot.getDefaultProjectForFile(filePath)
          const sourceFile = await project?.program.getSourceFile(filePath)
          if (!sourceFile) {
            throw new Error(`TypeScript did not parse ${filePath}`)
          }
          return [filePath, sourceFile] as const
        }),
      )
      return new Map(sourceFiles)
    } finally {
      await snapshot.dispose()
    }
  }
}
