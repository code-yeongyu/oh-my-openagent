import { describe, expect, test } from "bun:test"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import ts from "typescript"

const SOURCE_ROOT = path.resolve(import.meta.dir, "..")

const MOCK_MODULE_ALLOWLIST = new Map<string, string>([
  [
    path.join(SOURCE_ROOT, "tools", "ast-grep", "tools.test.ts"),
    // TODO(H10): Move the top-level CLI mock behind per-test dynamic import and restore it after each test.
    "top-level ast-grep CLI mock is installed before createAstGrepTools import",
  ],
  [
    path.join(SOURCE_ROOT, "features", "team-mode", "team-registry", "paths.test.ts"),
    // TODO(H10): Restore logger module mocks after registry path tests import the path helpers.
    "logger module mock is imported once to keep registry path tests quiet",
  ],
  [
    path.join(SOURCE_ROOT, "features", "team-mode", "team-runtime", "create.test.ts"),
    // TODO(H10): Restore resolve-member mock after createTeamRun import isolation is split per test.
    "resolve-member mock must be in place before createTeamRun is imported",
  ],
  [
    path.join(SOURCE_ROOT, "features", "team-mode", "team-mailbox", "inbox.test.ts"),
    // TODO(H10): Restore logger module mocks after inbox tests stop sharing one imported module graph.
    "logger module mock suppresses mailbox inbox logging during shared imports",
  ],
  [
    path.join(SOURCE_ROOT, "features", "team-mode", "team-mailbox", "poll.test.ts"),
    // TODO(H10): Restore ack module mock after poll tests can re-import the mailbox module per case.
    "ack module mock is installed before poll helper import",
  ],
  [
    path.join(SOURCE_ROOT, "features", "team-mode", "integration.test.ts"),
    // TODO(H10): Restore resolve-member mock after team integration imports are made test-local.
    "resolve-member mock controls team member routing for the integration fixture",
  ],
  [
    path.join(SOURCE_ROOT, "features", "background-agent", "process-cleanup.test.ts"),
    // TODO(H10): Replace the isolation marker mock with runner metadata or restore it after the file.
    "isolation marker mock routes signal tests away from the shared batch",
  ],
  [
    path.join(SOURCE_ROOT, "shared", "project-discovery-dirs.test.ts"),
    // TODO(H10): Restore child_process mock after worktree cache tests use per-test module imports.
    "child_process mock is scoped to a dynamic import but not restored afterward",
  ],
  [
    path.join(SOURCE_ROOT, "shared", "tmux", "tmux-utils", "pane-close.test.ts"),
    // TODO(H10): Restore tmux utility dependency mocks after pane-close imports become per-test.
    "tmux dependency mocks are installed before pane-close module import",
  ],
  [
    path.join(SOURCE_ROOT, "shared", "tmux", "tmux-utils", "session-kill.test.ts"),
    // TODO(H10): Restore tmux utility dependency mocks after session-kill imports become per-test.
    "tmux dependency mocks are installed before session-kill module import",
  ],
  [
    path.join(SOURCE_ROOT, "shared", "tmux", "tmux-utils", "pane-dimensions.test.ts"),
    // TODO(H10): Restore tmux runner mocks after pane dimension tests stop sharing one import graph.
    "tmux runner mock is installed before pane dimension module import",
  ],
  [
    path.join(SOURCE_ROOT, "shared", "tmux", "tmux-utils", "layout-runner.test.ts"),
    // TODO(H10): Restore layout runner dependency mocks after layout tests use isolated imports.
    "tmux layout dependency mocks are installed before layout runner import",
  ],
  [
    path.join(SOURCE_ROOT, "shared", "tmux", "tmux-utils", "session-kill-runner.test.ts"),
    // TODO(H10): Restore tmux runner mocks after session-kill runner imports become per-test.
    "tmux dependency mocks are installed before session-kill runner import",
  ],
  [
    path.join(SOURCE_ROOT, "shared", "tmux", "tmux-utils", "pane-close-runner.test.ts"),
    // TODO(H10): Restore tmux runner mocks after pane-close runner imports become per-test.
    "tmux dependency mocks are installed before pane-close runner import",
  ],
  [
    path.join(SOURCE_ROOT, "shared", "tmux", "tmux-utils", "stale-session-sweep-runtime.test.ts"),
    // TODO(H10): Restore sweep dependency mocks after stale-session sweep imports become per-test.
    "tmux sweep dependency mocks are installed before runtime import",
  ],
  [
    path.join(SOURCE_ROOT, "cli", "doctor", "checks", "dependencies.test.ts"),
    // TODO(H10): Restore downloader mock after dependency checks can be imported per case.
    "comment-checker downloader mock is installed before dependency check import",
  ],
  [
    path.join(SOURCE_ROOT, "hooks", "session-recovery", "index.test.ts"),
    // TODO(H10): Restore shared storage mock after thinking prepend imports stop sharing one module graph.
    "shared storage mock redirects session recovery fixtures to temp storage",
  ],
  [
    path.join(SOURCE_ROOT, "hooks", "anthropic-context-window-limit-recovery", "aggressive-truncation-strategy.test.ts"),
    // TODO(H10): Restore recovery dependency mocks after strategy imports are split per test.
    "storage and injector mocks are installed before recovery strategy import",
  ],
  [
    path.join(SOURCE_ROOT, "hooks", "zauc-mocks-hook", "hook.test.ts"),
    // TODO(H10): Restore auto-update startup mock after zauc hook imports become test-local.
    "auto-update startup mock blocks background checks during zauc hook tests",
  ],
  [
    path.join(SOURCE_ROOT, "hooks", "auto-update-checker", "checker", "cached-version.test.ts"),
    // TODO(H10): Restore constants and package locator mocks after cached-version imports become per-test.
    "auto-update checker mocks force deterministic version cache inputs",
  ],
  [
    path.join(SOURCE_ROOT, "hooks", "auto-update-checker", "hook.test.ts"),
    // TODO(H10): Restore latest-version and deferred-startup mocks after hook imports become per-test.
    "auto-update hook mocks prevent network and deferred startup work",
  ],
  [
    path.join(SOURCE_ROOT, "hooks", "legacy-plugin-toast", "auto-migrate.test.ts"),
    // TODO(H10): Restore plugin-entry migrator mocks after auto-migrate imports become per-test.
    "plugin-entry migrator mock controls legacy toast migration paths",
  ],
  [
    path.join(SOURCE_ROOT, "hooks", "atlas", "background-task-retry.test.ts"),
    // TODO(H10): Replace the sqlite isolation mock with runner metadata or restore it after the file.
    "storage detection mock isolates atlas retry tests that override timers",
  ],
])

async function listTestFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nestedFiles = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return listTestFiles(entryPath)
    }

    if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      return [entryPath]
    }

    return []
  }))

  return nestedFiles.flat()
}

function relativeSourcePath(filePath: string): string {
  return path.relative(SOURCE_ROOT, filePath)
}

function getPropertyName(node: ts.PropertyName | ts.MemberName | ts.Expression): string | null {
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
    return node.text
  }

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text
  }

  return null
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(expression)) {
    return unwrapExpression(expression.expression)
  }

  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
    return unwrapExpression(expression.expression)
  }

  if (ts.isNonNullExpression(expression)) {
    return unwrapExpression(expression.expression)
  }

  return expression
}

function getAccessPath(expression: ts.Expression): string[] {
  const unwrapped = unwrapExpression(expression)

  if (ts.isIdentifier(unwrapped)) {
    return [unwrapped.text]
  }

  if (ts.isPropertyAccessExpression(unwrapped) || ts.isPropertyAccessChain(unwrapped)) {
    const propertyName = getPropertyName(unwrapped.name)
    if (!propertyName) {
      return []
    }

    return [...getAccessPath(unwrapped.expression), propertyName]
  }

  if (ts.isElementAccessExpression(unwrapped) || ts.isElementAccessChain(unwrapped)) {
    const argument = unwrapped.argumentExpression
    if (!argument) {
      return []
    }

    const propertyName = getPropertyName(argument)
    if (!propertyName) {
      return []
    }

    return [...getAccessPath(unwrapped.expression), propertyName]
  }

  return []
}

function accessPathEquals(actual: readonly string[], expected: readonly string[]): boolean {
  if (actual.length !== expected.length) {
    return false
  }

  return expected.every((segment, index) => actual[index] === segment)
}

function isMockModuleCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node) || node.arguments.length < 2) {
    return false
  }

  return accessPathEquals(getAccessPath(node.expression), ["mock", "module"])
}

function isMockRestoreCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) {
    return false
  }

  const accessPath = getAccessPath(node.expression)
  return accessPathEquals(accessPath, ["mock", "restore"])
    || accessPathEquals(accessPath, ["mock", "module", "restore"])
}

function isLifecycleHookCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) {
    return false
  }

  const accessPath = getAccessPath(node.expression)
  return accessPathEquals(accessPath, ["afterEach"])
    || accessPathEquals(accessPath, ["afterAll"])
}

function nodeContainsMockRestore(root: ts.Node): boolean {
  let found = false

  const visit = (node: ts.Node): void => {
    if (found) {
      return
    }

    if (isMockRestoreCall(node)) {
      found = true
      return
    }

    ts.forEachChild(node, visit)
  }

  visit(root)
  return found
}

function hasLifecycleMockRestore(node: ts.CallExpression): boolean {
  const callback = node.arguments[0]
  if (!callback) {
    return false
  }

  return nodeContainsMockRestore(callback)
}

function auditMockModuleLifecycle(contents: string): { mockModuleCount: number; hasCleanup: boolean } {
  const sourceFile = ts.createSourceFile("mock-module-audit.ts", contents, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let mockModuleCount = 0
  let hasCleanup = false

  const visit = (node: ts.Node): void => {
    if (isMockModuleCall(node)) {
      mockModuleCount += 1
    }

    if (isMockRestoreCall(node)) {
      hasCleanup = true
    }

    if (isLifecycleHookCall(node) && hasLifecycleMockRestore(node)) {
      hasCleanup = true
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return { mockModuleCount, hasCleanup }
}

describe("mock.module lifecycle cleanup", () => {
  test("#given test files using mock.module #when lifecycle audit runs #then every file has explicit mock cleanup", async () => {
    // given
    const files = await listTestFiles(SOURCE_ROOT)
    const offenders: string[] = []

    // when
    for (const filePath of files) {
      if (MOCK_MODULE_ALLOWLIST.has(filePath)) {
        continue
      }

      const contents = await readFile(filePath, "utf8")
      const audit = auditMockModuleLifecycle(contents)
      if (audit.mockModuleCount > 0 && !audit.hasCleanup) {
        offenders.push(relativeSourcePath(filePath))
      }
    }

    // then
    expect(offenders).toEqual([])
  })
})
