import { API } from "typescript/unstable/async"
import type { SourceFile } from "typescript/unstable/ast"

// The connection to the native API process is gone: vscode-jsonrpc's ConnectionErrors.Closed (1) or .Disposed (2). The
// TypeScript API does not export the error class, so it is matched by its name and code.
const connectionGone = (error: unknown): boolean =>
  error instanceof Error &&
  error.constructor.name === "ConnectionError" &&
  "code" in error &&
  (error.code === 1 || error.code === 2)

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
    try {
      return await this.#parseWith(this.#api, filePaths)
    } catch (error) {
      if (!connectionGone(error)) throw error
      // A test that timed out has this process's children killed, the native API process among them (#13951): the next
      // parse starts a new one instead of failing on the dead connection.
      await this.#api.close().catch(() => undefined)
      this.#api = new API({ cwd: this.#cwd })
      return await this.#parseWith(this.#api, filePaths)
    }
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
