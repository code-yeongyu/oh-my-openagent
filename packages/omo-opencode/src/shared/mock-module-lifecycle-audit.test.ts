/// <reference types="bun-types" />

import { afterAll, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import * as ts from "typescript/unstable/ast"
import { TypeScriptSourceParser } from "./typescript-native-source-parser"

function __repoRootFrom(start: string): string {
  let dir = start
  for (;;) {
    if (existsSync(path.join(dir, "bun.lock")) || existsSync(path.join(dir, ".git"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error("repo root sentinel not found")
    dir = parent
  }
}

const SOURCE_ROOT = path.resolve(import.meta.dir, "..")
const WORKSPACE_ROOT = __repoRootFrom(import.meta.dir)
const parser = new TypeScriptSourceParser(WORKSPACE_ROOT)
afterAll(async () => {
  await parser.close()
})
const MOCK_MODULE_TOKEN = "mock.module"
const MOCK_MODULE_LIFECYCLE_ALLOWLIST = new Map<string, string>([
  // TODO(MOCK-MODULE-AUDIT): add cleanup for auto-update checker hook module mocks.
  [
    path.join(SOURCE_ROOT, "hooks", "auto-update-checker", "hook.test.ts"),
    "justification: legacy mock.module call predates audit; TODO(MOCK-MODULE-AUDIT): add cleanup",
  ],
  // TODO(MOCK-MODULE-AUDIT): add cleanup for tmux layout-runner module mocks.
  [
    path.join(SOURCE_ROOT, "shared", "tmux", "tmux-utils", "layout-runner.test.ts"),
    "justification: legacy mock.module call predates audit; TODO(MOCK-MODULE-AUDIT): add cleanup",
  ],
  // TODO(MOCK-MODULE-AUDIT): add cleanup for tmux pane-close-runner module mocks.
  [
    path.join(SOURCE_ROOT, "shared", "tmux", "tmux-utils", "pane-close-runner.test.ts"),
    "justification: legacy mock.module call predates audit; TODO(MOCK-MODULE-AUDIT): add cleanup",
  ],
  // TODO(MOCK-MODULE-AUDIT): add cleanup for tmux pane-close module mocks.
  [
    path.join(SOURCE_ROOT, "shared", "tmux", "tmux-utils", "pane-close.test.ts"),
    "justification: legacy mock.module call predates audit; TODO(MOCK-MODULE-AUDIT): add cleanup",
  ],
  // TODO(MOCK-MODULE-AUDIT): add cleanup for tmux pane-dimensions module mocks.
  [
    path.join(SOURCE_ROOT, "shared", "tmux", "tmux-utils", "pane-dimensions.test.ts"),
    "justification: legacy mock.module call predates audit; TODO(MOCK-MODULE-AUDIT): add cleanup",
  ],
  // TODO(MOCK-MODULE-AUDIT): add cleanup for tmux session-kill-runner module mocks.
  [
    path.join(SOURCE_ROOT, "shared", "tmux", "tmux-utils", "session-kill-runner.test.ts"),
    "justification: legacy mock.module call predates audit; TODO(MOCK-MODULE-AUDIT): add cleanup",
  ],
  // TODO(MOCK-MODULE-AUDIT): add cleanup for tmux session-kill module mocks.
  [
    path.join(SOURCE_ROOT, "shared", "tmux", "tmux-utils", "session-kill.test.ts"),
    "justification: legacy mock.module call predates audit; TODO(MOCK-MODULE-AUDIT): add cleanup",
  ],
  // TODO(MOCK-MODULE-AUDIT): add cleanup for tmux stale-session sweep module mocks.
  [
    path.join(SOURCE_ROOT, "shared", "tmux", "tmux-utils", "stale-session-sweep-runtime.test.ts"),
    "justification: legacy mock.module call predates audit; TODO(MOCK-MODULE-AUDIT): add cleanup",
  ],
  [
    path.join(WORKSPACE_ROOT, "packages", "openclaw-core", "src", "__tests__", "reply-listener-process.test.ts"),
    "justification: legacy openclaw-core mock.module call predates audit; TODO(MOCK-MODULE-AUDIT): add cleanup",
  ],
])

async function listTestFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nestedFiles = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return listTestFiles(entryPath)
    }
    if (entry.isFile() && entry.name.endsWith(".test.ts") && !entry.name.endsWith(".d.ts")) {
      return [entryPath]
    }
    return []
  }))

  return nestedFiles.flat()
}

async function listPackageTestFiles(): Promise<string[]> {
  const packagesDir = path.join(WORKSPACE_ROOT, "packages")
  let packageNames: string[] = []
  try {
    packageNames = await readdir(packagesDir)
  } catch {
    return []
  }

  const nestedFiles = await Promise.all(packageNames.map(async (name) => {
    if (name === "omo-opencode") {
      return []
    }
    const packageSrc = path.join(packagesDir, name, "src")
    try {
      const s = await stat(packageSrc)
      if (!s.isDirectory()) {
        return []
      }
    } catch {
      return []
    }
    return listTestFiles(packageSrc)
  }))

  return nestedFiles.flat()
}

function relativeSourcePath(filePath: string): string {
  return path.relative(SOURCE_ROOT, filePath)
}

function isMockModuleCall(node: ts.CallExpression): boolean {
  const expression = node.expression
  return ts.isPropertyAccessExpression(expression)
    && ts.isIdentifier(expression.expression)
    && expression.expression.text === "mock"
    && expression.name.text === "module"
}

function isStringLiteralLike(node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
}

function getMockModulePath(node: ts.CallExpression): string | null {
  if (!isMockModuleCall(node)) {
    return null
  }

  const modulePath = node.arguments[0]
  if (!modulePath || !isStringLiteralLike(modulePath)) {
    return null
  }

  return modulePath.text
}

function collectMockModulePaths(sourceFile: ts.SourceFile): string[] {
  const modulePaths: string[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const modulePath = getMockModulePath(node)
      if (modulePath) {
        modulePaths.push(modulePath)
      }
    }

    node.forEachChild(visit)
  }

  visit(sourceFile)
  return modulePaths
}

function hasMockModuleCall(sourceFile: ts.SourceFile): boolean {
  return collectMockModulePaths(sourceFile).length > 0
}

function hasDuplicateModuleReset(sourceFile: ts.SourceFile): boolean {
  const seenModulePaths = new Set<string>()
  for (const modulePath of collectMockModulePaths(sourceFile)) {
    if (seenModulePaths.has(modulePath)) {
      return true
    }
    seenModulePaths.add(modulePath)
  }

  return false
}

function isCleanupCall(node: ts.CallExpression): boolean {
  if (ts.isIdentifier(node.expression)) {
    return node.expression.text === "afterEach" || node.expression.text === "afterAll"
  }

  const expression = node.expression
  return ts.isPropertyAccessExpression(expression)
    && ts.isIdentifier(expression.expression)
    && expression.expression.text === "mock"
    && expression.name.text === "restore"
}

function hasCleanupPattern(sourceFile: ts.SourceFile): boolean {
  if (hasDuplicateModuleReset(sourceFile)) {
    return true
  }

  let foundCleanup = false

  const visit = (node: ts.Node): void => {
    if (foundCleanup) {
      return
    }

    if (ts.isCallExpression(node) && isCleanupCall(node)) {
      foundCleanup = true
      return
    }

    node.forEachChild(visit)
  }

  visit(sourceFile)
  return foundCleanup
}

type ParseSourceFiles = (filePaths: readonly string[]) => Promise<ReadonlyMap<string, ts.SourceFile>>

// Parsing goes through the TypeScript native API, which resolves a project per opened file; opening the whole
// test tree (thousands of files) blew the 20 s budget on loaded CI runners (#10681). Only files that contain the
// token can contain a mock.module call, so the text filter runs first and only those candidates are parsed.
async function auditMockModuleLifecycle(files: readonly string[], parse: ParseSourceFiles): Promise<string[]> {
  const candidates = (await Promise.all(files.map(async (filePath) => {
    if (MOCK_MODULE_LIFECYCLE_ALLOWLIST.has(filePath)) {
      return null
    }
    const contents = await readFile(filePath, "utf8")
    return contents.includes(MOCK_MODULE_TOKEN) ? filePath : null
  }))).filter((filePath): filePath is string => filePath !== null)
  const parsedSourceFiles = await parse(candidates)
  const offenders: string[] = []

  for (const filePath of candidates) {
    const sourceFile = parsedSourceFiles.get(filePath)
    if (!sourceFile) {
      throw new Error(`TypeScript did not parse ${filePath}`)
    }
    if (hasMockModuleCall(sourceFile) && !hasCleanupPattern(sourceFile)) {
      offenders.push(relativeSourcePath(filePath))
    }
  }

  return offenders.sort()
}

describe("mock.module lifecycle hygiene", () => {
  test("#given fixtures with and without mock.module #when audited #then only token-bearing files are parsed and the leak is flagged", async () => {
    // given
    const fixtureDir = await mkdtemp(path.join(tmpdir(), "mock-module-audit-"))
    try {
      const leak = path.join(fixtureDir, "leak.test.ts")
      const cleaned = path.join(fixtureDir, "cleaned.test.ts")
      const plain = path.join(fixtureDir, "plain.test.ts")
      await writeFile(leak, `import { mock } from "bun:test"\nmock.module("./dep", () => ({}))\n`)
      await writeFile(cleaned, `import { afterEach, mock } from "bun:test"\nmock.module("./dep", () => ({}))\nafterEach(() => mock.restore())\n`)
      await writeFile(plain, `import { expect, test } from "bun:test"\ntest("plain", () => expect(1).toBe(1))\n`)
      const parsedPaths: string[] = []
      const recordingParse: ParseSourceFiles = (filePaths) => {
        parsedPaths.push(...filePaths)
        return parser.parse(filePaths)
      }

      // when
      const offenders = await auditMockModuleLifecycle([leak, cleaned, plain], recordingParse)

      // then
      expect(parsedPaths.sort()).toEqual([cleaned, leak].sort())
      expect(offenders).toEqual([relativeSourcePath(leak)])
    } finally {
      await rm(fixtureDir, { recursive: true, force: true })
    }
  })

  test("#given test files using mock.module #when audited #then each must pair with cleanup", async () => {
    // given
    const files = [...await listTestFiles(SOURCE_ROOT), ...await listPackageTestFiles()]

    // when
    const offenders = await auditMockModuleLifecycle(files, (filePaths) => parser.parse(filePaths))

    // then
    expect(offenders).toEqual([])
  }, 20_000)
})
