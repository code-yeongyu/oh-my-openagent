import { realpathSync } from "node:fs"
import path, { relative, resolve, isAbsolute } from "node:path"

import { ALLOWED_EXTENSIONS } from "./constants"

export function resolveCanonical(targetPath: string): string {
  try {
    return realpathSync(targetPath)
  } catch {
    /* file doesn't exist — walk up to find an existing ancestor */
  }

  const parsed = path.parse(targetPath)
  let dir = parsed.dir
  let remainder = parsed.base

  while (dir !== path.parse(dir).root) {
    try {
      return path.join(realpathSync(dir), remainder)
    } catch {
      remainder = path.join(path.basename(dir), remainder)
      dir = path.dirname(dir)
    }
  }
  return targetPath
}

export function isAllowedFile(filePath: string, workspaceRoot: string): boolean {
  const resolved = resolve(workspaceRoot, filePath)

  const canonicalRoot = resolveCanonical(workspaceRoot)
  const canonicalFile = resolveCanonical(resolved)

  const rel = relative(canonicalRoot, canonicalFile)

  if (rel.startsWith("..") || isAbsolute(rel)) {
    return false
  }

  if (!/\.sisyphus[/\\]/i.test(rel)) {
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
