import { realpathSync } from "node:fs"
import { relative, resolve, isAbsolute, dirname, basename, join } from "node:path"

import { ALLOWED_EXTENSIONS, BLOCKED_FILES } from "./constants"

export function isAllowedFile(filePath: string, workspaceRoot: string): boolean {
  const resolved = resolve(workspaceRoot, filePath)
  const rel = relative(workspaceRoot, resolved)

  if (rel.startsWith("..") || isAbsolute(rel)) {
    return false
  }

  // Resolve symlinks in parent directory (file may not exist yet — can't realpathSync the file itself)
  try {
    const realDir = realpathSync(dirname(resolved))
    const realResolved = join(realDir, basename(resolved))
    const realRel = relative(workspaceRoot, realResolved)
    if (realRel.startsWith("..") || isAbsolute(realRel)) {
      return false
    }
  } catch {
    // Directory doesn't exist yet — symlinks can't exist here, lexical check suffices
  }

  if (!/\.sisyphus[/\\]/i.test(rel)) {
    return false
  }

  const filename = resolved.split(/[/\\]/).pop()?.toLowerCase() ?? ""
  if (BLOCKED_FILES.some(blocked => filename === blocked.toLowerCase())) {
    return false
  }

  const normalizedPath = rel.toLowerCase().replace(/\\/g, "/")

  // briefs/ — .md only
  if (normalizedPath.includes(".sisyphus/briefs/")) {
    return resolved.toLowerCase().endsWith(".md")
  }

  // bet-records/ — .json only
  if (normalizedPath.includes(".sisyphus/bet-records/")) {
    return resolved.toLowerCase().endsWith(".json")
  }

  // Default: .md or .json allowed
  const hasAllowedExtension = ALLOWED_EXTENSIONS.some(
    ext => resolved.toLowerCase().endsWith(ext.toLowerCase())
  )
  if (!hasAllowedExtension) {
    return false
  }

  return true
}
