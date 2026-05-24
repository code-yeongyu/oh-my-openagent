import { describe, expect, test } from "bun:test"
import { readdir, readFile } from "node:fs/promises"
import { dirname, extname, join } from "node:path"
import { fileURLToPath } from "node:url"

type CouplingMatch = {
  readonly filePath: string
  readonly lineNumber: number
  readonly line: string
}

const forbiddenImportPatterns = [/from\s+["']@opencode-ai\//, /from\s+["']\.\.\/opencode\//] as const

async function collectTypeScriptFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const childPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectTypeScriptFiles(childPath)))
      continue
    }

    if (entry.isFile() && extname(entry.name) === ".ts") {
      files.push(childPath)
    }
  }

  return files
}

function findForbiddenImports(filePath: string, content: string): readonly CouplingMatch[] {
  const matches: CouplingMatch[] = []
  const lines = content.split(/\r?\n/)

  for (const [index, line] of lines.entries()) {
    if (!forbiddenImportPatterns.some((pattern) => pattern.test(line))) continue
    matches.push({ filePath, lineNumber: index + 1, line })
  }

  return matches
}

describe("opencode coupling audit", () => {
  test("#given prompts-core source #when scanning imports #then no OpenCode adapter imports exist", async () => {
    // given
    const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
    const srcRoot = join(packageRoot, "src")
    const sourceFiles = await collectTypeScriptFiles(srcRoot)
    const matches: CouplingMatch[] = []

    // when
    for (const filePath of sourceFiles) {
      const content = await readFile(filePath, "utf8")
      matches.push(...findForbiddenImports(filePath, content))
    }

    // then
    console.info("opencode coupling matches:", JSON.stringify(matches))
    expect(matches).toEqual([])
  })
})
