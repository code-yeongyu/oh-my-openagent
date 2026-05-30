import { describe, expect, test } from "bun:test"
import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"
import ts from "typescript"

const SOURCE_ROOT = path.resolve(import.meta.dir, "..")
const WORKSPACE_ROOT = path.resolve(SOURCE_ROOT, "..")
const MOCK_MODULE_TOKEN = "mock.module"

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

function isTopLevelNode(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  let current = node.parent
  while (current && current !== sourceFile) {
    if (ts.isFunctionLike(current) || ts.isClassLike(current)) {
      return false
    }
    current = current.parent
  }

  return true
}

function hasTopLevelMockModuleCall(sourceFile: ts.SourceFile): boolean {
  let foundTopLevelMock = false

  const visit = (node: ts.Node): void => {
    if (foundTopLevelMock) {
      return
    }

    if (ts.isCallExpression(node) && isMockModuleCall(node) && isTopLevelNode(node, sourceFile)) {
      foundTopLevelMock = true
      return
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return foundTopLevelMock
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

function isMockRestoreCall(node: ts.CallExpression): boolean {
  const expression = node.expression
  return ts.isPropertyAccessExpression(expression)
    && ts.isIdentifier(expression.expression)
    && expression.expression.text === "mock"
    && expression.name.text === "restore"
}

function isCleanupCall(node: ts.CallExpression): boolean {
  if (ts.isIdentifier(node.expression)) {
    return node.expression.text === "afterEach" || node.expression.text === "afterAll"
  }

  return isMockRestoreCall(node)
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

function afterAllCallsMockRestore(node: ts.CallExpression): boolean {
  if (!ts.isIdentifier(node.expression) || node.expression.text !== "afterAll") {
    return false
  }

  const callback = node.arguments[0]
  if (!callback) {
    return false
  }

  let foundRestore = false
  const visit = (child: ts.Node): void => {
    if (foundRestore) {
      return
    }

    if (ts.isCallExpression(child) && isMockRestoreCall(child)) {
      foundRestore = true
      return
    }

    ts.forEachChild(child, visit)
  }

  visit(callback)
  return foundRestore
}

function hasAfterAllMockRestore(sourceFile: ts.SourceFile): boolean {
  let foundCleanup = false

  const visit = (node: ts.Node): void => {
    if (foundCleanup) {
      return
    }

    if (ts.isCallExpression(node) && afterAllCallsMockRestore(node)) {
      foundCleanup = true
      return
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return foundCleanup
}

function hasTopLevelMockRestore(sourceFile: ts.SourceFile): boolean {
  let foundCleanup = false

  const visit = (node: ts.Node): void => {
    if (foundCleanup) {
      return
    }

    if (ts.isCallExpression(node) && isMockRestoreCall(node) && isTopLevelNode(node, sourceFile)) {
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
    const files = [...await listTestFiles(SOURCE_ROOT), ...await listPackageTestFiles()]
    const offenders: string[] = []

    // when
    for (const filePath of files) {
      const contents = await readFile(filePath, "utf8")
      if (!contents.includes(MOCK_MODULE_TOKEN)) {
        continue
      }
      const sourceFile = ts.createSourceFile(filePath, contents, ts.ScriptTarget.Latest, true)
      if (
        hasTopLevelMockModuleCall(sourceFile)
        && !hasAfterAllMockRestore(sourceFile)
        && !hasTopLevelMockRestore(sourceFile)
      ) {
        offenders.push(relativeSourcePath(filePath))
        continue
      }

      if (hasMockModuleCall(sourceFile) && !hasCleanupPattern(sourceFile)) {
        offenders.push(relativeSourcePath(filePath))
      }
    }

    // then
    expect(offenders.sort()).toEqual([])
  }, 20_000)
})
