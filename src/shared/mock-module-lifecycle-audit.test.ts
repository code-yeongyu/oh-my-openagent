import { describe, expect, test } from "bun:test"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import ts from "typescript"

const SOURCE_ROOT = path.resolve(import.meta.dir, "..")
const AUDIT_FILE = path.join(SOURCE_ROOT, "shared", "mock-module-lifecycle-audit.test.ts")
const MOCK_MODULE_ALLOWLIST = new Map<string, string>([
  [
    path.join(SOURCE_ROOT, "tools", "ast-grep", "tools.test.ts"),
    "TODO(H10): legacy mock.module call relies on global test setup; add local mock.restore lifecycle cleanup.",
  ],
  [
    path.join(SOURCE_ROOT, "features", "team-mode", "team-mailbox", "inbox.test.ts"),
    "TODO(H10): legacy mock.module call relies on global test setup; add local mock.restore lifecycle cleanup.",
  ],
  [
    path.join(SOURCE_ROOT, "cli", "doctor", "checks", "dependencies.test.ts"),
    "TODO(H10): legacy mock.module call relies on global test setup; add local mock.restore lifecycle cleanup.",
  ],
  [
    path.join(SOURCE_ROOT, "hooks", "session-recovery", "index.test.ts"),
    "TODO(H10): legacy mock.module call relies on global test setup; add local mock.restore lifecycle cleanup.",
  ],
  [
    path.join(SOURCE_ROOT, "hooks", "auto-update-checker", "hook.test.ts"),
    "TODO(H10): legacy mock.module call relies on global test setup; add local mock.restore lifecycle cleanup.",
  ],
  [
    path.join(SOURCE_ROOT, "features", "background-agent", "process-cleanup.test.ts"),
    "TODO(H10): legacy mock.module call relies on global test setup; add local mock.restore lifecycle cleanup.",
  ],
  [
    path.join(SOURCE_ROOT, "features", "team-mode", "integration.test.ts"),
    "TODO(H10): legacy mock.module call relies on global test setup; add local mock.restore lifecycle cleanup.",
  ],
  [
    path.join(SOURCE_ROOT, "features", "team-mode", "team-mailbox", "poll.test.ts"),
    "TODO(H10): legacy mock.module call relies on global test setup; add local mock.restore lifecycle cleanup.",
  ],
  [
    path.join(SOURCE_ROOT, "features", "team-mode", "team-registry", "paths.test.ts"),
    "TODO(H10): legacy mock.module call relies on global test setup; add local mock.restore lifecycle cleanup.",
  ],
  [
    path.join(SOURCE_ROOT, "features", "team-mode", "team-runtime", "create.test.ts"),
    "TODO(H10): legacy mock.module call relies on global test setup; add local mock.restore lifecycle cleanup.",
  ],
  [
    path.join(SOURCE_ROOT, "features", "team-mode", "team-runtime", "resolve-member.test.ts"),
    "TODO(H10): legacy mock.module call relies on global test setup; add local mock.restore lifecycle cleanup.",
  ],
  [
    path.join(SOURCE_ROOT, "hooks", "anthropic-context-window-limit-recovery", "aggressive-truncation-strategy.test.ts"),
    "TODO(H10): legacy mock.module call relies on global test setup; add local mock.restore lifecycle cleanup.",
  ],
  [
    path.join(SOURCE_ROOT, "hooks", "atlas", "background-task-retry.test.ts"),
    "TODO(H10): legacy mock.module call relies on global test setup; add local mock.restore lifecycle cleanup.",
  ],
  [
    path.join(SOURCE_ROOT, "hooks", "auto-update-checker", "checker", "cached-version.test.ts"),
    "TODO(H10): legacy mock.module call relies on global test setup; add local mock.restore lifecycle cleanup.",
  ],
  [
    path.join(SOURCE_ROOT, "hooks", "legacy-plugin-toast", "auto-migrate.test.ts"),
    "TODO(H10): legacy mock.module call relies on global test setup; add local mock.restore lifecycle cleanup.",
  ],
  [
    path.join(SOURCE_ROOT, "hooks", "zauc-mocks-hook", "hook.test.ts"),
    "TODO(H10): legacy mock.module call relies on global test setup; add local mock.restore lifecycle cleanup.",
  ],
  [
    path.join(SOURCE_ROOT, "shared", "project-discovery-dirs.test.ts"),
    "TODO(H10): legacy mock.module call relies on global test setup; add local mock.restore lifecycle cleanup.",
  ],
  [
    path.join(SOURCE_ROOT, "shared", "tmux", "tmux-utils", "layout-runner.test.ts"),
    "TODO(H10): legacy mock.module call relies on global test setup; add local mock.restore lifecycle cleanup.",
  ],
  [
    path.join(SOURCE_ROOT, "shared", "tmux", "tmux-utils", "pane-close-runner.test.ts"),
    "TODO(H10): legacy mock.module call relies on global test setup; add local mock.restore lifecycle cleanup.",
  ],
  [
    path.join(SOURCE_ROOT, "shared", "tmux", "tmux-utils", "pane-close.test.ts"),
    "TODO(H10): legacy mock.module call relies on global test setup; add local mock.restore lifecycle cleanup.",
  ],
  [
    path.join(SOURCE_ROOT, "shared", "tmux", "tmux-utils", "pane-dimensions.test.ts"),
    "TODO(H10): legacy mock.module call relies on global test setup; add local mock.restore lifecycle cleanup.",
  ],
  [
    path.join(SOURCE_ROOT, "shared", "tmux", "tmux-utils", "session-kill-runner.test.ts"),
    "TODO(H10): legacy mock.module call relies on global test setup; add local mock.restore lifecycle cleanup.",
  ],
  [
    path.join(SOURCE_ROOT, "shared", "tmux", "tmux-utils", "session-kill.test.ts"),
    "TODO(H10): legacy mock.module call relies on global test setup; add local mock.restore lifecycle cleanup.",
  ],
  [
    path.join(SOURCE_ROOT, "shared", "tmux", "tmux-utils", "stale-session-sweep-runtime.test.ts"),
    "TODO(H10): legacy mock.module call relies on global test setup; add local mock.restore lifecycle cleanup.",
  ],
])

async function listTestFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nestedFiles = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return listTestFiles(entryPath)
    }
    if (
      entry.isFile()
      && entry.name.endsWith(".test.ts")
      && !entry.name.endsWith(".d.ts")
      && entryPath !== AUDIT_FILE
    ) {
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

function isIdentifierExpression(expression: ts.Expression, name: string): boolean {
  const unwrapped = unwrapExpression(expression)
  return ts.isIdentifier(unwrapped) && unwrapped.text === name
}

function isNamedMemberAccess(expression: ts.Expression, owner: string, member: string): boolean {
  const unwrapped = unwrapExpression(expression)

  if (ts.isPropertyAccessExpression(unwrapped) || ts.isPropertyAccessChain(unwrapped)) {
    return getPropertyName(unwrapped.name) === member
      && isIdentifierExpression(unwrapped.expression, owner)
  }

  if (ts.isElementAccessExpression(unwrapped) || ts.isElementAccessChain(unwrapped)) {
    const argument = unwrapped.argumentExpression
    return Boolean(argument)
      && getPropertyName(argument) === member
      && isIdentifierExpression(unwrapped.expression, owner)
  }

  return false
}

function isMockModuleMember(expression: ts.Expression): boolean {
  return isNamedMemberAccess(expression, "mock", "module")
}

function isMockModuleCall(node: ts.CallExpression): boolean {
  return isMockModuleMember(node.expression)
}

function isMockRestoreCall(node: ts.CallExpression): boolean {
  return isNamedMemberAccess(node.expression, "mock", "restore")
}

function isMockModuleRestoreCall(node: ts.CallExpression): boolean {
  const expression = unwrapExpression(node.expression)

  if (ts.isPropertyAccessExpression(expression) || ts.isPropertyAccessChain(expression)) {
    return getPropertyName(expression.name) === "restore"
      && isMockModuleMember(expression.expression)
  }

  if (ts.isElementAccessExpression(expression) || ts.isElementAccessChain(expression)) {
    const argument = expression.argumentExpression
    return Boolean(argument)
      && getPropertyName(argument) === "restore"
      && isMockModuleMember(expression.expression)
  }

  return false
}

function isBunSemverExpression(expression: ts.Expression): boolean {
  return isNamedMemberAccess(expression, "Bun", "semver")
}

function isBunSemverResetCall(node: ts.CallExpression): boolean {
  const expression = unwrapExpression(node.expression)

  if (ts.isPropertyAccessExpression(expression) || ts.isPropertyAccessChain(expression)) {
    const name = getPropertyName(expression.name)
    return Boolean(name?.toLowerCase().includes("reset"))
      && isBunSemverExpression(expression.expression)
  }

  if (ts.isElementAccessExpression(expression) || ts.isElementAccessChain(expression)) {
    const argument = expression.argumentExpression
    const name = argument ? getPropertyName(argument) : null
    return Boolean(name?.toLowerCase().includes("reset"))
      && isBunSemverExpression(expression.expression)
  }

  return false
}

function hasMockModuleCall(sourceFile: ts.SourceFile): boolean {
  let found = false

  const visit = (node: ts.Node): void => {
    if (found) {
      return
    }

    if (ts.isCallExpression(node) && isMockModuleCall(node)) {
      found = true
      return
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return found
}

function hasLifecycleName(node: ts.CallExpression): boolean {
  return ts.isIdentifier(node.expression)
    && (node.expression.text === "afterEach" || node.expression.text === "afterAll")
}

function hasCleanupCall(node: ts.Node): boolean {
  let found = false

  const visit = (child: ts.Node): void => {
    if (found) {
      return
    }

    if (
      ts.isCallExpression(child)
      && (isMockRestoreCall(child) || isMockModuleRestoreCall(child) || isBunSemverResetCall(child))
    ) {
      found = true
      return
    }

    ts.forEachChild(child, visit)
  }

  visit(node)
  return found
}

function hasLifecycleCleanup(sourceFile: ts.SourceFile): boolean {
  let found = false

  const visit = (node: ts.Node): void => {
    if (found) {
      return
    }

    if (ts.isCallExpression(node) && hasLifecycleName(node)) {
      const callback = node.arguments[0]
      if (callback && hasCleanupCall(callback)) {
        found = true
        return
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return found
}

function isKnownResetHelperSpecifier(specifier: string): boolean {
  return specifier.includes("test-setup") || specifier.includes("module-mock-lifecycle")
}

function hasKnownResetHelperImport(sourceFile: ts.SourceFile): boolean {
  let found = false

  const visit = (node: ts.Node): void => {
    if (found) {
      return
    }

    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      found = isKnownResetHelperSpecifier(node.moduleSpecifier.text)
      return
    }

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") {
      const specifier = node.arguments[0]
      if (specifier && ts.isStringLiteral(specifier)) {
        found = isKnownResetHelperSpecifier(specifier.text)
        return
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return found
}

function hasMockModuleCleanup(sourceFile: ts.SourceFile): boolean {
  return hasLifecycleCleanup(sourceFile) || hasKnownResetHelperImport(sourceFile)
}

describe("mock.module lifecycle hygiene", () => {
  test("#given test files using mock.module #when audited #then each must pair with cleanup", async () => {
    // given
    const files = await listTestFiles(SOURCE_ROOT)
    const offenders: string[] = []

    // when
    for (const filePath of files) {
      if (MOCK_MODULE_ALLOWLIST.has(filePath)) {
        continue
      }

      const contents = await readFile(filePath, "utf8")
      const sourceFile = ts.createSourceFile(filePath, contents, ts.ScriptTarget.Latest, true)
      if (hasMockModuleCall(sourceFile) && !hasMockModuleCleanup(sourceFile)) {
        offenders.push(relativeSourcePath(filePath))
      }
    }

    // then
    expect(offenders.sort()).toEqual([])
  })
})
