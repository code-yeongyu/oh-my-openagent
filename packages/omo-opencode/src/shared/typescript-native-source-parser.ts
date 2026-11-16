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

  constructor(cwd: string) {
    this.#cwd = cwd
    this.#api = new API({ cwd })
  }

  async parse(filePaths: readonly string[]): Promise<ReadonlyMap<string, SourceFile>> {
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

  async close(): Promise<void> {
    await this.#api.close()
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
