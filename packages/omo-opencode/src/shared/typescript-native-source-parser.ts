import { API } from "typescript/unstable/async"
import type { SourceFile } from "typescript/unstable/ast"

export class TypeScriptSourceParser {
  readonly #api: API

  constructor(cwd: string) {
    this.#api = new API({ cwd })
  }

  async parse(filePaths: readonly string[]): Promise<ReadonlyMap<string, SourceFile>> {
    const snapshot = await this.#api.updateSnapshot({ openFiles: [...filePaths] })
    try {
      const sourceFiles = await Promise.all(filePaths.map(async (filePath) => {
        const project = await snapshot.getDefaultProjectForFile(filePath)
        const sourceFile = await project?.program.getSourceFile(filePath)
        if (!sourceFile) {
          throw new Error(`TypeScript did not parse ${filePath}`)
        }
        return [filePath, sourceFile] as const
      }))
      return new Map(sourceFiles)
    } finally {
      await snapshot.dispose()
    }
  }

  async close(): Promise<void> {
    await this.#api.close()
  }
}
