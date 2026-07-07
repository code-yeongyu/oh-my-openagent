import { normalize } from "node:path"

/**
 * Normalize session directory strings for filter comparison.
 * Strips trailing slashes (except root "/") and applies path.normalize.
 * Does not resolve symlinks or change case.
 */
function toPosixSeparators(path: string): string {
  return path.replace(/\\/g, "/")
}

export function normalizeSessionDirectory(directory: string): string {
  if (directory === "/" || directory === "\\") return "/"
  const withoutTrailing = directory.replace(/[/\\]+$/, "") || "/"
  return toPosixSeparators(normalize(withoutTrailing))
}

export function sessionDirectoriesMatch(stored: string, filter: string): boolean {
  return normalizeSessionDirectory(stored) === normalizeSessionDirectory(filter)
}