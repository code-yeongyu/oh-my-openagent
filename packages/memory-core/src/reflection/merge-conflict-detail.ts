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
  if (paths.length > 0) return `Merge conflict in ${formatPathList(paths)}`
  const conflictLines = listLines(stdout).filter((line) => line.startsWith("CONFLICT"))
  return boundDetail(conflictLines.length > 0 ? conflictLines.join("; ") : stderr)
}

/** Lists at most ten paths, then the count of the rest, so a detail never grows with the change set. */
export function formatPathList(paths: readonly string[]): string {
  const listed = boundDetail(paths.slice(0, MAX_LISTED_PATHS).join(", "))
  return paths.length > MAX_LISTED_PATHS ? `${listed} (+${paths.length - MAX_LISTED_PATHS} more)` : listed
}

/** Trims git output and caps it, so a failure detail stays bounded whatever git printed. */
export function boundDetail(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > MAX_FALLBACK_LENGTH ? `${trimmed.slice(0, MAX_FALLBACK_LENGTH)}...` : trimmed
}
