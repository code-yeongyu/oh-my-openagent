import { describe, expect, it } from "bun:test"
import { existsSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

const repoRoot = join(import.meta.dir, "..", "..", "..")
const packageRoot = join(repoRoot, "packages", "omo-codex")

const requiredRetainedPythonFiles = [
  "packages/omo-codex/plugin/components/lsp/test/fixtures/broken.py",
] as const
const optionalGeneratedPythonFiles = [
  "packages/omo-codex/plugin/skills/frontend/references/ui-ux-db/scripts/core.py",
  "packages/omo-codex/plugin/skills/frontend/references/ui-ux-db/scripts/design_system.py",
  "packages/omo-codex/plugin/skills/frontend/references/ui-ux-db/scripts/search.py",
  "packages/omo-codex/plugin/skills/frontend/scripts/perfection/lighthouse-audit.py",
  "packages/omo-codex/plugin/skills/programming/scripts/go/new-project.py",
  "packages/omo-codex/plugin/skills/programming/scripts/python/check-no-excuse-rules.py",
  "packages/omo-codex/plugin/skills/programming/scripts/python/new-project.py",
  "packages/omo-codex/plugin/skills/programming/scripts/python/new-script.py",
  "packages/omo-codex/plugin/skills/programming/scripts/rust/check-no-excuse-rules.py",
  "packages/omo-codex/plugin/skills/programming/scripts/rust/new-project.py",
] as const
const retainedPythonFiles = [
  ...requiredRetainedPythonFiles,
  ...optionalGeneratedPythonFiles,
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
    const expectedPythonFiles = [
      ...requiredRetainedPythonFiles,
      ...optionalGeneratedPythonFiles.filter((path) => existsSync(join(repoRoot, path))),
    ].sort()
    expect(pythonFiles).toEqual(expectedPythonFiles)
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
