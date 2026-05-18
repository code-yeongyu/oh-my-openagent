import { describe, expect, test } from "bun:test"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import ts from "typescript"

const SOURCE_ROOT = path.resolve(import.meta.dir, "..")
const MOCK_MODULE_TOKEN = "mock.module"
const MOCK_MODULE_LIFECYCLE_ALLOWLIST = new Map<string, string>([
  // TODO(MOCK-MODULE-AUDIT): add cleanup for team mailbox inbox module mocks.
  [
    path.join(SOURCE_ROOT, "features", "team-mode", "team-mailbox", "inbox.test.ts"),
    "justification: legacy mock.module call predates audit; TODO(MOCK-MODULE-AUDIT): add cleanup",
  ],
  // TODO(MOCK-MODULE-AUDIT): add cleanup for doctor dependency module mocks.
  [
    path.join(SOURCE_ROOT, "cli", "doctor", "checks", "dependencies.test.ts"),
    "justification: legacy mock.module call predates audit; TODO(MOCK-MODULE-AUDIT): add cleanup",
  ],
  // TODO(MOCK-MODULE-AUDIT): add cleanup for session recovery module mocks.
  [
    path.join(SOURCE_ROOT, "hooks", "session-recovery", "index.test.ts"),
    "justification: legacy mock.module call predates audit; TODO(MOCK-MODULE-AUDIT): add cleanup",
  ],
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

function getMockModulePath(node: ts.CallExpression): string | null {
  if (!isMockModuleCall(node)) {
    return null
  }

  const modulePath = node.arguments[0]
  if (!modulePath || !ts.isStringLiteralLike(modulePath)) {
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

    ts.forEachChild(node, visit)
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

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return foundCleanup
}

describe("mock.module lifecycle hygiene", () => {
  test("#given test files using mock.module #when audited #then each must pair with cleanup", async () => {
    // given
    const files = await listTestFiles(SOURCE_ROOT)
    const offenders: string[] = []

    // when
    for (const filePath of files) {
      if (MOCK_MODULE_LIFECYCLE_ALLOWLIST.has(filePath)) {
        continue
      }

      const contents = await readFile(filePath, "utf8")
      if (!contents.includes(MOCK_MODULE_TOKEN)) {
        continue
      }
      const sourceFile = ts.createSourceFile(filePath, contents, ts.ScriptTarget.Latest, true)
      if (hasMockModuleCall(sourceFile) && !hasCleanupPattern(sourceFile)) {
        offenders.push(relativeSourcePath(filePath))
      }
    }

    // then
    expect(offenders.sort()).toEqual([])
  }, 20_000)
})
