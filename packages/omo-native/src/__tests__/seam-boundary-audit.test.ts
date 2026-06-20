import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

type ImportHit = {
  readonly filePath: string
  readonly lineNumber: number
  readonly statement: string
  readonly specifier: string
}

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url))
const SRC_ROOT = path.resolve(TEST_DIR, "..")
const SENPI_SEAM_ROOT = path.join(SRC_ROOT, "senpi")
const TEST_ROOT = path.join(SRC_ROOT, "__tests__")

function isInsideDirectory(filePath: string, directory: string): boolean {
  const relativePath = path.relative(directory, filePath)
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
}

function formatAuditHits(hits: readonly ImportHit[]): string {
  if (hits.length === 0) {
    return "No raw senpi/pi imports found."
  }

  return hits
    .map((hit) => `${path.relative(SRC_ROOT, hit.filePath)}:${hit.lineNumber} imports ${hit.specifier} via ${hit.statement}`)
    .join("\n")
}

function lineNumberForIndex(contents: string, index: number): number {
  return contents.slice(0, index).split("\n").length
}

function isRawSenpiOrPiSpecifier(specifier: string): boolean {
  return (
    specifier.startsWith("@earendil-works/pi")
    || specifier.startsWith("@earendil-works/senpi")
    || specifier === "senpi"
    || specifier.startsWith("senpi/")
    || specifier.startsWith("@senpi/")
    || specifier === "packages/senpi"
    || specifier.startsWith("packages/senpi/")
    || specifier.includes("packages/senpi/")
    || /(?:^|\/)\.\.\/senpi(?:\/|$)/.test(specifier)
  )
}

async function listTypeScriptFiles(directory: string): Promise<readonly string[]> {
  if (!existsSync(directory)) {
    return []
  }

  const entries = await readdir(directory, { withFileTypes: true })
  const nestedFiles = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return listTypeScriptFiles(entryPath)
    }

    if (entry.isFile() && entry.name.endsWith(".ts")) {
      return [entryPath]
    }

    return []
  }))

  return nestedFiles.flat().sort()
}

function collectImportHits(filePath: string, contents: string): readonly ImportHit[] {
  const importLikePattern = /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g
  const dynamicImportPattern = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
  const hits: ImportHit[] = []

  for (const pattern of [importLikePattern, dynamicImportPattern]) {
    for (const match of contents.matchAll(pattern)) {
      if (typeof match.index !== "number") {
        continue
      }

      const specifier = match[1]
      if (typeof specifier !== "string") {
        continue
      }

      hits.push({
        filePath,
        lineNumber: lineNumberForIndex(contents, match.index),
        statement: match[0].replace(/\s+/g, " ").trim(),
        specifier,
      })
    }
  }

  return hits
}

async function collectRawSenpiOrPiImports(files: readonly string[]): Promise<readonly ImportHit[]> {
  const nestedHits = await Promise.all(files.map(async (filePath) => {
    const contents = await readFile(filePath, "utf8")
    return collectImportHits(filePath, contents).filter((hit) => isRawSenpiOrPiSpecifier(hit.specifier))
  }))

  return nestedHits.flat()
}

function isTypeLayerImport(hit: ImportHit): boolean {
  return /\b(?:import|export)\s+type\b/.test(hit.statement)
}

describe("omo-native seam boundary audit", () => {
  it("rejects direct senpi/pi imports outside src/senpi", async () => {
    // given
    const sourceFiles = await listTypeScriptFiles(SRC_ROOT)
    const filesOutsideSeam = sourceFiles.filter((filePath) => (
      !isInsideDirectory(filePath, SENPI_SEAM_ROOT)
      && !isInsideDirectory(filePath, TEST_ROOT)
    ))

    // when
    const rawImports = await collectRawSenpiOrPiImports(filesOutsideSeam)

    // then
    expect(rawImports, formatAuditHits(rawImports)).toEqual([])
  })

  it("requires the senpi seam to own at least one real senpi type-layer import", async () => {
    // given
    const seamFiles = await listTypeScriptFiles(SENPI_SEAM_ROOT)

    // when
    const typeLayerImports = (await collectRawSenpiOrPiImports(seamFiles)).filter(isTypeLayerImport)

    // then
    expect(
      typeLayerImports.length,
      "Expected src/senpi/** to contain at least one `import type` or `export type` from the real senpi/pi type layer. This Wave 0 RED proves the seam is still a stub.",
    ).toBeGreaterThan(0)
  })
})
