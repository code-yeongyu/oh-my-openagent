import { describe, expect, test } from "bun:test"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

const WORKSPACE_ROOT = path.resolve(import.meta.dir, "../..")
const PACKAGES_DIR = path.join(WORKSPACE_ROOT, "packages")
const SKIP_PACKAGES = new Set(["lsp-tools-mcp"])

const OPENCODE_IMPORT_RE = /from\s+['"](@opencode-ai\/[^'"]+|opencode\/[^'"]+)['"]/
const BUN_API_RE = /(?<!runtime\.)\bBun\.(spawn|file|write|which|hash)\b/

async function listPackageSourceFiles(): Promise<string[]> {
  let packageNames: string[] = []
  try {
    packageNames = await readdir(PACKAGES_DIR)
  } catch {
    return []
  }

  const nestedFiles = await Promise.all(packageNames.map(async (name) => {
    if (SKIP_PACKAGES.has(name)) {
      return []
    }

    const packageSrc = path.join(PACKAGES_DIR, name, "src")
    const entries = await listSourceFilesRecursive(packageSrc)
    return entries
  }))

  return nestedFiles.flat()
}

async function listSourceFilesRecursive(directory: string): Promise<string[]> {
  let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[] = []
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }

  const nestedFiles = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return listSourceFilesRecursive(entryPath)
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

function relativeWorkspacePath(filePath: string): string {
  return path.relative(WORKSPACE_ROOT, filePath)
}

describe("package opencode coupling grep gate", () => {
  test("#given package source files #when audited #then no file imports from @opencode-ai/* or opencode/", async () => {
    // given
    const files = await listPackageSourceFiles()
    const offenders: string[] = []

    // when
    for (const filePath of files) {
      const contents = await readFile(filePath, "utf8")
      const lines = contents.split("\n")
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const match = OPENCODE_IMPORT_RE.exec(line)
        if (match) {
          offenders.push(`${relativeWorkspacePath(filePath)}:${i + 1}  imports ${match[1]}`)
        }
      }
    }

    // then
    expect(offenders.sort()).toEqual([])
  }, 20_000)

  test("#given package source files #when audited #then no file uses Bun.spawn, Bun.file, Bun.write, Bun.which, or Bun.hash", async () => {
    // given
    const files = await listPackageSourceFiles()
    const offenders: string[] = []

    // when
    for (const filePath of files) {
      const contents = await readFile(filePath, "utf8")
      const lines = contents.split("\n")
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const match = BUN_API_RE.exec(line)
        if (match) {
          offenders.push(`${relativeWorkspacePath(filePath)}:${i + 1}  uses ${match[0]}`)
        }
      }
    }

    // then
    expect(offenders.sort()).toEqual([])
  }, 20_000)
})
