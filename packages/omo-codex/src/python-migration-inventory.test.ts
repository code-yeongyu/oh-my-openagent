import { describe, expect, it } from "bun:test"
import { readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

const repoRoot = join(import.meta.dir, "..", "..", "..")
const packageRoot = join(repoRoot, "packages", "omo-codex")

const retainedPythonFiles = [
  "packages/omo-codex/plugin/components/lsp/test/fixtures/broken.py",
] as const
const retainedPythonFileSet = new Set<string>(retainedPythonFiles)

describe("omo-codex Python migration inventory", () => {
  it("classifies every Python file under packages/omo-codex", () => {
    // given
    const pythonFiles = listPythonFiles(packageRoot)

    // when
    const unclassified = pythonFiles.filter((path) => !retainedPythonFileSet.has(path))

    // then
    expect(unclassified).toEqual([])
    expect(pythonFiles).toEqual([...retainedPythonFiles].sort())
  })
})

function listPythonFiles(root: string): readonly string[] {
  const files: string[] = []
  collectPythonFiles(root, files)
  return files.sort()
}

function collectPythonFiles(directory: string, files: string[]): void {
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry === "dist") continue

    const absolutePath = join(directory, entry)
    const stats = statSync(absolutePath)
    if (stats.isDirectory()) {
      collectPythonFiles(absolutePath, files)
      continue
    }

    if (entry.endsWith(".py") || entry.endsWith(".pyi")) {
      files.push(relative(repoRoot, absolutePath).split(sep).join("/"))
    }
  }
}
