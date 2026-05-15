import { describe, expect, test } from "bun:test"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

const SOURCE_ROOT = path.resolve(import.meta.dir, "..")
const PROMPT_GATE_FILE = path.join(SOURCE_ROOT, "shared", "prompt-async-gate.ts")

async function listSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nestedFiles = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return listSourceFiles(entryPath)
    }
    if (
      entry.isFile()
      && entry.name.endsWith(".ts")
      && !entry.name.endsWith(".test.ts")
      && !entry.name.endsWith(".d.ts")
    ) {
      return [entryPath]
    }
    return []
  }))

  return nestedFiles.flat()
}

function relativeSourcePath(filePath: string): string {
  return path.relative(SOURCE_ROOT, filePath)
}

function uncommentedLines(contents: string): string[] {
  return contents
    .split("\n")
    .map((line) => line.trimStart())
    .filter((line) => !line.startsWith("//") && !line.startsWith("*"))
}

describe("production prompt injection routes", () => {
  test("#given production TypeScript sources #when prompt routes are audited #then only the shared gate may call raw OpenCode prompt APIs", async () => {
    // given
    const files = await listSourceFiles(SOURCE_ROOT)
    const offenders: string[] = []

    // when
    for (const filePath of files) {
      if (filePath === PROMPT_GATE_FILE) {
        continue
      }

      const contents = uncommentedLines(await readFile(filePath, "utf8")).join("\n")
      if (/\bsession\.promptAsync\s*\(/.test(contents) || /\bsession\.prompt\s*\(/.test(contents)) {
        offenders.push(relativeSourcePath(filePath))
      }
    }

    // then
    expect(offenders).toEqual([])
  })

  test("#given production TypeScript sources #when prompt gate callers are audited #then callers cannot disable the post-dispatch reservation hold", async () => {
    // given
    const files = await listSourceFiles(SOURCE_ROOT)
    const offenders: string[] = []

    // when
    for (const filePath of files) {
      const contents = uncommentedLines(await readFile(filePath, "utf8")).join("\n")
      if (/postDispatchHoldMs\s*:\s*0\b/.test(contents)) {
        offenders.push(relativeSourcePath(filePath))
      }
    }

    // then
    expect(offenders).toEqual([])
  })
})
