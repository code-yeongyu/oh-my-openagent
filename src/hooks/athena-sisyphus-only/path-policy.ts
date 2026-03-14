import { dirname, isAbsolute, relative, resolve } from "node:path"
import { existsSync, realpathSync } from "node:fs"

/**
 * Cross-platform path validator for Athena file writes.
 * Uses path.resolve/relative instead of string matching to handle:
 * - Windows backslashes (e.g., .sisyphus\\notepads\\x.yaml)
 * - Mixed separators (e.g., .sisyphus\\plans/x.md)
 * - Case-insensitive directory matching
 * - Workspace confinement (blocks paths outside root or via traversal)
 * - No extension restriction: any file type is allowed inside .sisyphus/
 */
function isWithinRoot(targetPath: string, rootPath: string): boolean {
  const rel = relative(rootPath, targetPath)
  return !((rel === ".." || rel.startsWith("../") || rel.startsWith("..\\")) || isAbsolute(rel))
}

function isWithinSisyphusSubtree(targetPath: string, rootPath: string): boolean {
  const rel = relative(rootPath, targetPath)
  return /(^|[\/\\])\.sisyphus([\/\\]|$)/i.test(rel)
}

function getNearestExistingPath(targetPath: string): string | null {
  let current = targetPath
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) {
      return null
    }
    current = parent
  }
  return current
}

export function isAllowedPath(filePath: string, workspaceRoot: string): boolean {
  const resolvedWorkspaceRoot = resolve(workspaceRoot)
  const resolved = resolve(resolvedWorkspaceRoot, filePath)

  const rel = relative(resolvedWorkspaceRoot, resolved)
  if (!isWithinRoot(resolved, resolvedWorkspaceRoot)) {
    return false
  }

  if (!/(^|[\/\\])\.sisyphus([\/\\]|$)/i.test(rel)) {
    return false
  }

  if (!existsSync(resolvedWorkspaceRoot)) {
    return true
  }

  const existingPath = getNearestExistingPath(resolved)
  if (!existingPath) {
    return false
  }

  const realWorkspaceRoot = realpathSync(resolvedWorkspaceRoot)
  const realExistingPath = realpathSync(existingPath)
  if (!isWithinRoot(realExistingPath, realWorkspaceRoot)) {
    return false
  }

  // Allow bootstrap writes when nearest existing path is workspace root itself
  // and the target path is within .sisyphus subtree
  if (realExistingPath === realWorkspaceRoot) {
    return isWithinSisyphusSubtree(resolved, realWorkspaceRoot)
  }

  if (!isWithinSisyphusSubtree(realExistingPath, realWorkspaceRoot)) {
    return false
  }

  return true
}
