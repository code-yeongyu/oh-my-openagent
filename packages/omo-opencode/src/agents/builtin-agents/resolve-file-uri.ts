import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { isWithinProject } from "../../shared/contains-path"
import { log } from "../../shared/logger"

const ALLOWED_HOME_SUBDIRS = [
  join(homedir(), ".config", "opencode"),
  join(homedir(), ".config", "oh-my-openagent"),
  join(homedir(), ".omo"),
  join(homedir(), ".opencode"),
] as const

function isWithinAllowedPaths(filePath: string, projectRoot: string): boolean {
  if (isWithinProject(filePath, projectRoot)) return true
  for (const dir of ALLOWED_HOME_SUBDIRS) {
    if (isWithinProject(filePath, dir)) return true
  }
  return false
}

export function resolvePromptAppend(promptAppend: string, configDir?: string): string {
  if (!promptAppend.startsWith("file://")) return promptAppend

  const encoded = promptAppend.slice(7)

  let filePath: string
  try {
    const decoded = decodeURIComponent(encoded)
    const expanded = decoded.startsWith("~/") ? decoded.replace(/^~\//, `${homedir()}/`) : decoded
    filePath = isAbsolute(expanded)
      ? expanded
      : resolve(configDir ?? process.cwd(), expanded)
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return `[WARNING: Malformed file URI (invalid percent-encoding): ${promptAppend}]`
  }

  const projectRoot = configDir ?? process.cwd()
  if (!isWithinAllowedPaths(filePath, projectRoot)) {
    log("[resolve-file-uri] Rejected file URI outside allowed paths", {
      promptAppend,
      filePath,
      projectRoot,
      allowedHomeSubdirs: [...ALLOWED_HOME_SUBDIRS],
    })
    return `[WARNING: Path rejected: ${promptAppend} (resolved outside project root ${projectRoot} and allowed home directories; file:// prompts must reside within the project directory, ~/.config/opencode/, ~/.config/oh-my-openagent/, ~/.omo/, or ~/.opencode/)]`
  }

  if (!existsSync(filePath)) {
    return `[WARNING: Could not resolve file URI: ${promptAppend}]`
  }

  try {
    return readFileSync(filePath, "utf8")
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return `[WARNING: Could not read file: ${promptAppend}]`
  }
}
