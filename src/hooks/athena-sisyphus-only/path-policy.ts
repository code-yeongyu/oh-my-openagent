import { relative, resolve, isAbsolute } from "node:path"

/**
 * Cross-platform path validator for Athena file writes.
 * Uses path.resolve/relative instead of string matching to handle:
 * - Windows backslashes (e.g., .sisyphus\\notepads\\x.yaml)
 * - Mixed separators (e.g., .sisyphus\\plans/x.md)
 * - Case-insensitive directory matching
 * - Workspace confinement (blocks paths outside root or via traversal)
 * - No extension restriction: any file type is allowed inside .sisyphus/
 */
export function isAllowedPath(filePath: string, workspaceRoot: string): boolean {
  // 1. Resolve to absolute path
  const resolved = resolve(workspaceRoot, filePath)

  // 2. Get relative path from workspace root
  const rel = relative(workspaceRoot, resolved)

  // 3. Reject if escapes root (starts with ".." or is absolute)
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return false
  }

  // 4. Check if .sisyphus/ or .sisyphus\ exists anywhere in the path (case-insensitive)
  if (!/\.sisyphus[/\\]/i.test(rel)) {
    return false
  }

  return true
}
