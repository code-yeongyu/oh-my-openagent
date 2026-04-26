import { existsSync, readFileSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, resolve, sep } from "node:path"
import { isWithinProject } from "../../shared/contains-path"
import { log } from "../../shared/logger"

const homeDir = homedir()

/** User directories allowed for global file:// URIs (security whitelist).
 *  Built with path.join + trailing sep so startsWith works on all platforms. */
const ALLOWED_GLOBAL_PREFIXES = [
  join(homeDir, ".config") + sep,
  join(homeDir, ".hermes") + sep,
  join(homeDir, ".local", "share") + sep,
]

function isAllowedGlobalPath(filePath: string): boolean {
  try {
    const canonicalPath = realpathSync.native(filePath)
    return ALLOWED_GLOBAL_PREFIXES.some((prefix) => canonicalPath.startsWith(prefix))
  } catch {
    // File doesn't exist yet — canonicalize the deepest existing parent
    let current = filePath
    // walk up until we hit the filesystem root (dirname stops changing)
    for (;;) {
      const parent = dirname(current)
      if (parent === current) break // reached root (e.g. C:\ or /), no existing ancestor
      current = parent
      try {
        const canonicalParent = realpathSync.native(current)
        // Reconstruct canonical child path, then resolve to collapse any
        // directory-traversal segments (e.g. ../) that may be in the remaining suffix
        const remaining = filePath.slice(current.length)
        const reconstructed = resolve(canonicalParent, `.${remaining}`)
        return ALLOWED_GLOBAL_PREFIXES.some((prefix) => reconstructed.startsWith(prefix))
      } catch {
        // Parent also doesn't exist, keep going up
      }
    }
    // No existing ancestor found — reject (secure by default)
    return false
  }
}

export function resolvePromptAppend(
  promptAppend: string,
  configDir?: string,
  /** When true, allow user-level paths outside project root (security whitelist enforced) */
  allowOutsideProject?: boolean
): string {
  if (!promptAppend.startsWith("file://")) return promptAppend

  const encoded = promptAppend.slice(7)

  let filePath: string
  try {
    const decoded = decodeURIComponent(encoded)
    const expanded = decoded.startsWith("~/") ? decoded.replace(/^~\//, `${homedir()}/`) : decoded
    filePath = isAbsolute(expanded)
      ? expanded
      : resolve(configDir ?? process.cwd(), expanded)
  } catch {
    return `[WARNING: Malformed file URI (invalid percent-encoding): ${promptAppend}]`
  }

  if (allowOutsideProject) {
    if (!isAllowedGlobalPath(filePath)) {
      log("[resolve-file-uri] Rejected file URI outside allowed global paths", {
        promptAppend,
        filePath,
        allowed: ALLOWED_GLOBAL_PREFIXES,
      })
      return `[WARNING: Path rejected (outside allowed global paths): ${promptAppend}]`
    }
  } else {
    const projectRoot = configDir ?? process.cwd()
    if (!isWithinProject(filePath, projectRoot)) {
      log("[resolve-file-uri] Rejected file URI outside project root", {
        promptAppend,
        filePath,
        projectRoot,
      })
      return `[WARNING: Path rejected: ${promptAppend}]`
    }
  }

  if (!existsSync(filePath)) {
    return `[WARNING: Could not resolve file URI: ${promptAppend}]`
  }

  try {
    return readFileSync(filePath, "utf8")
  } catch {
    return `[WARNING: Could not read file: ${promptAppend}]`
  }
}
