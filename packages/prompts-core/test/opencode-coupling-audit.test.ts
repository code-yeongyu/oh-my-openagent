import { describe, expect, test } from "bun:test"
import { readdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const SOURCE_DIR = join(dirname(fileURLToPath(import.meta.url)), "../src")

describe("opencode coupling audit", () => {
  test("#given prompts-core source #then no file imports @opencode-ai packages", async () => {
    const offenders = await findOpenCodeImports(SOURCE_DIR)

    expect(offenders).toEqual([])
  })

  test("#given prompts-core source #when markdown imports are scanned #then they stay package-relative", async () => {
    const offenders = await findExternalMarkdownImports(SOURCE_DIR)

    expect(offenders).toEqual([])
  })
})

async function findOpenCodeImports(sourceDir: string): Promise<readonly string[]> {
  const files = await collectTypeScriptFiles(sourceDir)
  const offenders: string[] = []

  for (const filePath of files) {
    const source = await readFile(filePath, "utf8")
    if (source.includes("@opencode-ai")) offenders.push(filePath)
  }

  return offenders
}

async function collectTypeScriptFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectTypeScriptFiles(entryPath)))
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(entryPath)
    }
  }

  return files
}

async function findExternalMarkdownImports(sourceDir: string): Promise<readonly string[]> {
  const files = await collectTypeScriptFiles(sourceDir)
  const offenders: string[] = []

  for (const filePath of files) {
    const source = await readFile(filePath, "utf8")
    for (const specifier of collectMarkdownImportSpecifiers(source)) {
      if (!specifier.startsWith("../prompts/")) offenders.push(`${filePath}: ${specifier}`)
    }
  }

  return offenders
}

function collectMarkdownImportSpecifiers(source: string): readonly string[] {
  const specifiers: string[] = []
  const pattern = /import\s+(?:[^"']+\s+from\s+)?["']([^"']+\.md)["']/g

  for (const match of source.matchAll(pattern)) {
    const specifier = match[1]
    if (specifier !== undefined) specifiers.push(specifier)
  }

  return specifiers
}
