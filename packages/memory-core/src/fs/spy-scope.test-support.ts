import { isAbsolute, relative, resolve } from "node:path"

/**
 * Determines whether a path observed by a process-global fs spy falls within
 * the fixture's own directory (#11963). Spies must act only on candidate
 * paths for which this returns true; all other calls pass to the original.
 */
export function landsIn(root: string, candidate: unknown): boolean {
  if (typeof candidate !== "string" || candidate.length === 0) return false
  const resolvedRoot = resolve(root)
  const resolvedCandidate = resolve(candidate)
  if (resolvedCandidate === resolvedRoot) return true
  const rel = relative(resolvedRoot, resolvedCandidate)
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)
}
