const MAX_LISTED_PATHS = 10
const MAX_FALLBACK_LENGTH = 500

export function listLines(output: string): readonly string[] {
  return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

/**
 * Names what conflicted. Git prints `CONFLICT (...)` on stdout, not stderr, so the detail comes from the
 * unmerged path list first and git's own CONFLICT lines second (#12075).
 */
export function describeMergeConflict(paths: readonly string[], stdout: string, stderr: string): string {
  if (paths.length > 0) {
    const listed = paths.slice(0, MAX_LISTED_PATHS).join(", ")
    const more = paths.length > MAX_LISTED_PATHS ? ` (+${paths.length - MAX_LISTED_PATHS} more)` : ""
    return `Merge conflict in ${listed}${more}`
  }
  const conflictLines = listLines(stdout).filter((line) => line.startsWith("CONFLICT"))
  const fallback = conflictLines.length > 0 ? conflictLines.join("; ") : stderr.trim()
  return fallback.length > MAX_FALLBACK_LENGTH ? `${fallback.slice(0, MAX_FALLBACK_LENGTH)}...` : fallback
}
