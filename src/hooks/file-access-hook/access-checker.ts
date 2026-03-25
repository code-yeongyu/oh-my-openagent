import { relative, resolve, isAbsolute } from "node:path"
import type { FileAccessConfig, FileAccessResult } from "./types"

export function checkFileAccess(
  filePath: string,
  config: FileAccessConfig,
  workspaceRoot: string
): FileAccessResult {
  const resolved = resolve(workspaceRoot, filePath)
  const rel = relative(workspaceRoot, resolved)

  if (rel.startsWith("..") || isAbsolute(rel)) {
    return { allowed: false, reason: "Path escapes workspace root" }
  }

  if (config.deniedExtensions) {
    for (const ext of config.deniedExtensions) {
      if (resolved.toLowerCase().endsWith(ext.toLowerCase())) {
        return { allowed: false, reason: `Extension ${ext} is denied` }
      }
    }
  }

  if (config.deniedPaths) {
    for (const deniedPath of config.deniedPaths) {
      const normalizedDenied = deniedPath.toLowerCase().replace(/\\/g, "/")
      const normalizedRel = rel.toLowerCase().replace(/\\/g, "/")
      if (normalizedRel.includes(normalizedDenied)) {
        return { allowed: false, reason: `Path matches denied pattern: ${deniedPath}` }
      }
    }
  }

  if (config.allowedPaths) {
    let matchesAllowed = false
    for (const allowedPath of config.allowedPaths) {
      const normalizedAllowed = allowedPath.toLowerCase().replace(/\\/g, "/")
      const normalizedRel = rel.toLowerCase().replace(/\\/g, "/")
      if (normalizedRel.includes(normalizedAllowed)) {
        matchesAllowed = true
        break
      }
    }
    if (!matchesAllowed) {
      return { allowed: false, reason: "Path not in allowed paths" }
    }
  }

  if (config.allowedExtensions) {
    let matchesAllowed = false
    for (const ext of config.allowedExtensions) {
      if (resolved.toLowerCase().endsWith(ext.toLowerCase())) {
        matchesAllowed = true
        break
      }
    }
    if (!matchesAllowed) {
      return { allowed: false, reason: "Extension not in allowed extensions" }
    }
  }

  return { allowed: true }
}
