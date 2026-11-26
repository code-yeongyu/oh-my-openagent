import { afterAll, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { type GitReader, gitTrees } from "./remote-import-guard-git-trees"
import { createResolver } from "./remote-import-guard-resolve"
import { ADAPTER_RULES } from "./remote-import-guard-rules"
import { scanRepository } from "./remote-import-guard-scan"

// Architecture contract (#14364, review 6066135750): the narrowed importer search answers exactly what the guard's full
// scan answers, for every edge form the scanner records. Each form is pinned alone in its own repository, so a form the
// search misses cannot hide behind another importer of the same file.

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

const PACKAGE = {
  name: "@fx/p",
  exports: { ".": "./src/index.ts", "./sub": "./src/target.ts", "./wild/*": "./src/wild/*.ts" },
  imports: { "#t": "./src/target.ts", "#w/*": "./src/wild/*.ts" },
}

function repository(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "importer-search-"))
  roots.push(root)
  const all: Record<string, string> = {
    "packages/p/package.json": JSON.stringify(PACKAGE),
    "packages/p/src/index.ts": "export const index = 1\n",
    "packages/p/src/target.ts": "export const a = 1\nexport type A = number\n",
    "packages/p/src/wild/w.ts": "export const w = 1\n",
    "packages/p/src/dir/index.ts": "export const d = 1\n",
    "packages/q/package.json": JSON.stringify({ name: "@fx/q" }),
    ...files,
  }
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  const run = (...args: string[]): string => execFileSync("git", args, { cwd: root, encoding: "utf8" })
  run("init", "-q")
  run("add", "-A")
  run("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "fixture")
  return root
}

const reader =
  (root: string): GitReader =>
  (args) => {
    try {
      return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    } catch {
      return undefined
    }
  }

const fullScan = (root: string, file: string): boolean => {
  const resolve = createResolver(root)
  return scanRepository(root).some(
    (fact) =>
      !ADAPTER_RULES.testFile(fact.file) && fact.edges.some((edge) => resolve(fact.file, edge.specifier) === file),
  )
}

const narrowed = (root: string, file: string): boolean =>
  gitTrees(reader(root), "HEAD", root, () => []).isImported(file)

const TARGET = "packages/p/src/target.ts"
const cases: ReadonlyArray<readonly [string, string, string, string, boolean]> = [
  ["static import", "packages/q/src/u.ts", 'import { a } from "../../p/src/target"\n', TARGET, true],
  ["type-only import", "packages/q/src/u.ts", 'import type { A } from "../../p/src/target"\n', TARGET, true],
  ["export-from", "packages/q/src/u.ts", 'export { a } from "../../p/src/target"\n', TARGET, true],
  ["dynamic import", "packages/q/src/u.ts", 'export const m = () => import("../../p/src/target")\n', TARGET, true],
  ["require call", "packages/q/src/u.cjs", 'module.exports = require("../../p/src/target.ts")\n', TARGET, true],
  [
    "import-equals require",
    "packages/q/src/u.ts",
    'import t = require("../../p/src/target")\nexport { t }\n',
    TARGET,
    true,
  ],
  ["package export", "packages/q/src/u.ts", 'import { a } from "@fx/p/sub"\nexport { a }\n', TARGET, true],
  [
    "wildcard package export",
    "packages/q/src/u.ts",
    'import { w } from "@fx/p/wild/w"\nexport { w }\n',
    "packages/p/src/wild/w.ts",
    true,
  ],
  ["# alias", "packages/p/src/use.ts", 'import { a } from "#t"\nexport { a }\n', TARGET, true],
  [
    "directory index",
    "packages/q/src/u.ts",
    'import { d } from "../../p/src/dir"\nexport { d }\n',
    "packages/p/src/dir/index.ts",
    true,
  ],
  ["a mention that is not an import", "packages/q/src/u.ts", 'export const label = "target"\n', TARGET, false],
  [
    "an importer that is a test file",
    "packages/q/src/u.test.ts",
    'import { a } from "../../p/src/target"\n',
    TARGET,
    false,
  ],
]

describe("the narrowed importer search against the full scan", () => {
  for (const [form, importer, text, target, expected] of cases) {
    test(`#given only ${form} #then the narrowed answer is the full scan's (${expected})`, () => {
      const root = repository({ [importer]: text })
      expect({ narrowed: narrowed(root, target), full: fullScan(root, target) }).toEqual({
        narrowed: expected,
        full: expected,
      })
    })
  }
})
