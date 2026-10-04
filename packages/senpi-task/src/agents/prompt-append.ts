import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"

type PromptAppendRoots = {
  readonly projectDir: string
  readonly homeDir: string
}

/**
 * Resolves an `agents.<name>.prompt_append` value the way the OpenCode edition's `mergeAgentConfig`
 * resolves an agent override: a `file://` URI is read from disk (with `~` expansion and paths
 * relative to the project directory), and any other value is literal text. Failures resolve to a
 * `[WARNING: ...]` string instead of throwing, so a broken reference never kills a spawn - the
 * warning lands verbatim in the child's instructions.
 */
export function resolvePromptAppend(value: string, roots: PromptAppendRoots): string {
  if (!value.startsWith("file://")) return value

  const encoded = value.slice(7)

  let filePath: string
  try {
    const decoded = decodeURIComponent(encoded)
    const expanded = decoded.startsWith("~/") ? decoded.replace(/^~\//, `${roots.homeDir}/`) : decoded
    filePath = isAbsolute(expanded) ? expanded : resolve(roots.projectDir, expanded)
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return `[WARNING: Malformed file URI (invalid percent-encoding): ${value}]`
  }

  if (!isWithinAllowedPaths(filePath, roots)) {
    return `[WARNING: Path rejected: ${value} (resolved outside the project directory and allowed home directories; file:// prompts must reside within the project directory, ~/.omo/, or ~/.senpi/)]`
  }

  if (!existsSync(filePath)) {
    return `[WARNING: Could not resolve file URI: ${value}]`
  }

  try {
    return readFileSync(filePath, "utf8")
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return `[WARNING: Could not read file: ${value}]`
  }
}

function isWithinAllowedPaths(filePath: string, roots: PromptAppendRoots): boolean {
  return (
    isWithin(roots.projectDir, filePath)
    || isWithin(join(roots.homeDir, ".omo"), filePath)
    || isWithin(join(roots.homeDir, ".senpi"), filePath)
  )
}

function isWithin(directory: string, target: string): boolean {
  const nested = relative(resolve(directory), resolve(target))
  return nested === "" || (!nested.startsWith("..") && !isAbsolute(nested))
}
