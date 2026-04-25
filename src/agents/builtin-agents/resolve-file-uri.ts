import { existsSync, readFileSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, resolve } from "node:path"
import { isWithinProject } from "../../shared/contains-path"
import { log } from "../../shared/logger"

/** User directories allowed for global file:// URIs (security whitelist) */
const ALLOWED_GLOBAL_PREFIXES = [
  `${homedir()}/.config/`,
  `${homedir()}/.hermes/`,
  `${homedir()}/.local/share/`,
]

function isAllowedGlobalPath(filePath: string): boolean {
  try {
    const canonicalPath = realpathSync.native(filePath)
    return ALLOWED_GLOBAL_PREFIXES.some((prefix) => canonicalPath.startsWith(prefix))
  } catch {
    return ALLOWED_GLOBAL_PREFIXES.some((prefix) => filePath.startsWith(prefix))
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
