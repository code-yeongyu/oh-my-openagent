import { normalize, parse, sep } from "node:path"

/**
 * Normalize session directory strings for filter comparison.
 * Strips trailing separators (except platform roots) and applies path.normalize.
 * Does not resolve symlinks or change case.
 */
function toComparisonSeparators(path: string): string {
  return sep === "\\" ? path.replace(/\\/g, "/") : path
}

export function normalizeSessionDirectory(directory: string): string {
  const normalized = normalize(directory)
  const root = parse(normalized).root
  const withoutTrailing = normalized !== root && normalized.endsWith(sep)
    ? normalized.slice(0, -1)
    : normalized
  return toComparisonSeparators(withoutTrailing)
}

export function sessionDirectoriesMatch(stored: string, filter: string): boolean {
  return normalizeSessionDirectory(stored) === normalizeSessionDirectory(filter)
}
