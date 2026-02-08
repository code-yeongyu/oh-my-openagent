import { relative, resolve, isAbsolute } from "node:path"

import { ALLOWED_EXTENSIONS } from "./constants"

/**
 * Cross-platform path validator for Prometheus file writes.
 * Uses path.resolve/relative instead of string matching to handle:
 * - Windows backslashes (e.g., .sisyphus\\plans\\x.md)
 * - Mixed separators (e.g., .sisyphus\\plans/x.md)
 * - Case-insensitive directory/extension matching
 * - Workspace confinement (blocks paths outside root or via traversal)
 * - Nested project paths (e.g., parent/.sisyphus/... when ctx.directory is parent)
 */
export function isAllowedFile(filePath: string, workspaceRoot: string): boolean {
  // 1. Resolve to absolute path
  const resolved = resolve(workspaceRoot, filePath)

  // 2. Get relative path from workspace root
  const rel = relative(workspaceRoot, resolved)

  // 3. Reject if escapes root (starts with ".." or is absolute)
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return false
  }

  // 4. Check if .sisyphus/ or .sisyphus\ exists anywhere in the path (case-insensitive)
  // This handles both direct paths (.sisyphus/x.md) and nested paths (project/.sisyphus/x.md)
  if (!/\.sisyphus[/\\]/i.test(rel)) {
    return false
  }

  // 5. Check extension matches one of ALLOWED_EXTENSIONS (case-insensitive)
  const hasAllowedExtension = ALLOWED_EXTENSIONS.some(
    ext => resolved.toLowerCase().endsWith(ext.toLowerCase())
  )
  if (!hasAllowedExtension) {
    return false
  }

  return true
}
