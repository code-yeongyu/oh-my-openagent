import { relative, resolve, isAbsolute } from "node:path"

import { ALLOWED_EXTENSIONS, BLOCKED_FILES } from "./constants"

export function isAllowedFile(filePath: string, workspaceRoot: string): boolean {
  const resolved = resolve(workspaceRoot, filePath)
  const rel = relative(workspaceRoot, resolved)

  if (rel.startsWith("..") || isAbsolute(rel)) {
    return false
  }

  if (!/\.sisyphus[/\\]/i.test(rel)) {
    return false
  }

  const filename = resolved.split(/[/\\]/).pop()?.toLowerCase() ?? ""
  if (BLOCKED_FILES.some(blocked => filename === blocked.toLowerCase())) {
    return false
  }

  const hasAllowedExtension = ALLOWED_EXTENSIONS.some(
    ext => resolved.toLowerCase().endsWith(ext.toLowerCase())
  )
  if (!hasAllowedExtension) {
    return false
  }

  return true
}
