import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

const RAW_BUN_RUNTIME_API_RE =
  /(?<![.$\w])Bun\.(spawn|spawnSync|file|write|which|hash|serve|readableStreamToText)\b/g
const RAW_BUN_MODULE_RE =
  /\b(?:from\s*["']bun:[^"']+["']|import\s*\(\s*["']bun:[^"']+["']\s*\)|require\s*\(\s*["']bun:[^"']+["']\s*\))/g
const APPROVED_BUN_SHIM_RE = /^bun-[a-z0-9-]+-shim\.ts$/

function repoRootFrom(start: string): string {
  let dir = start
  for (;;) {
    if (existsSync(path.join(dir, "bun.lock")) || existsSync(path.join(dir, ".git"))) {
      return dir
    }

    const parent = path.dirname(dir)
    if (parent === dir) {
      throw new Error("repo root sentinel not found")
    }
    dir = parent
  }
}

const WORKSPACE_ROOT = repoRootFrom(import.meta.dir)
const OPENCODE_SRC_DIR = path.join(WORKSPACE_ROOT, "packages", "omo-opencode", "src")

async function listAdapterSourceFiles(directory: string): Promise<string[]> {
  let entries: Awaited<ReturnType<typeof readdir>>
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }

  const nestedFiles = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return listAdapterSourceFiles(entryPath)
    }
    if (entry.isFile() && isAuditedProductionSource(entryPath)) {
      return [entryPath]
    }
    return []
  }))

  return nestedFiles.flat()
}

function isAuditedProductionSource(filePath: string): boolean {
  const basename = path.basename(filePath)
  const relativePath = relativeAdapterPath(filePath)

  return (
    basename.endsWith(".ts")
    && !basename.endsWith(".d.ts")
    && !basename.endsWith(".test.ts")
    && !basename.endsWith(".smoke.ts")
    && !basename.endsWith("test-support.ts")
    && !basename.endsWith("-test-fixture.ts")
    && !basename.endsWith(".fixture.ts")
    && !basename.endsWith(".fixtures.ts")
    && !APPROVED_BUN_SHIM_RE.test(basename)
    && !relativePath.includes("/__tests__/")
    && !relativePath.includes("/fixtures/")
    && !relativePath.includes("/test-fixtures/")
  )
}

function relativeAdapterPath(filePath: string): string {
  return path.relative(WORKSPACE_ROOT, filePath).split(path.sep).join("/")
}

function isInsideStringLiteral(line: string, position: number): boolean {
  let quote: "'" | '"' | "`" | null = null
  let escaped = false

  for (let index = 0; index < position; index += 1) {
    const char = line.charAt(index)

    if (escaped) {
      escaped = false
      continue
    }

    if (quote !== null && char === "\\") {
      escaped = true
      continue
    }

    if (char === "'" || char === '"' || char === "`") {
      if (quote === char) {
        quote = null
      } else if (quote === null) {
        quote = char
      }
    }
  }

  return quote !== null
}

function isLineComment(line: string, position: number): boolean {
  const prefix = line.slice(0, position)
  const commentStart = prefix.indexOf("//")
  return commentStart !== -1 && !isInsideStringLiteral(prefix, commentStart)
}

function isTypeOnlyBunReference(line: string, position: number): boolean {
  return /\btypeof\s+$/.test(line.slice(0, position))
}

function isTypeOnlyBunModuleReference(line: string, position: number): boolean {
  const prefix = line.slice(0, position)
  return /\b(?:type\s+\w+\s*=\s*|typeof\s+)$/.test(prefix)
}

function formatOffender(filePath: string, lineNumber: number, apiName: string): string {
  return `${relativeAdapterPath(filePath)}:${lineNumber} uses ${apiName}`
}

describe("OpenCode adapter Bun runtime audit", () => {
  test("#given production adapter source #when audited #then raw Bun runtime APIs and modules are shimmed", async () => {
    // Given
    const files = await listAdapterSourceFiles(OPENCODE_SRC_DIR)
    const offenders: string[] = []

    // When
    for (const filePath of files) {
      const contents = await readFile(filePath, "utf8")
      let insideBlockComment = false

      for (const [lineIndex, line] of contents.split("\n").entries()) {
        const trimmed = line.trimStart()

        if (insideBlockComment || trimmed.startsWith("/*")) {
          insideBlockComment = !trimmed.includes("*/")
          continue
        }

        RAW_BUN_RUNTIME_API_RE.lastIndex = 0
        for (const match of line.matchAll(RAW_BUN_RUNTIME_API_RE)) {
          if (
            match.index === undefined
            || isInsideStringLiteral(line, match.index)
            || isLineComment(line, match.index)
            || isTypeOnlyBunReference(line, match.index)
          ) {
            continue
          }

          offenders.push(formatOffender(filePath, lineIndex + 1, match[0]))
        }

        RAW_BUN_MODULE_RE.lastIndex = 0
        for (const match of line.matchAll(RAW_BUN_MODULE_RE)) {
          if (
            match.index === undefined
            || isLineComment(line, match.index)
            || isInsideStringLiteral(line, match.index)
            || isTypeOnlyBunModuleReference(line, match.index)
          ) {
            continue
          }

          offenders.push(formatOffender(filePath, lineIndex + 1, match[0]))
        }
      }
    }

    // Then
    expect(
      offenders.sort(),
      `Expected production OpenCode adapter source to use shared Bun runtime shims.\n${offenders.join("\n")}`,
    ).toEqual([])
  }, 20_000)
})
