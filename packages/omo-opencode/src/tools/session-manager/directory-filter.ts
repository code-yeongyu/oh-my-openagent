import { normalize } from "node:path"

/**
 * Normalize session directory strings for filter comparison.
 * Strips trailing slashes (except root "/") and applies path.normalize.
 * Does not resolve symlinks or change case.
 */
export function normalizeSessionDirectory(directory: string): string {
  if (directory === "/") return "/"
  const withoutTrailing = directory.replace(/\/+$/, "") || "/"
  return normalize(withoutTrailing)
}

export function sessionDirectoriesMatch(stored: string, filter: string): boolean {
  return normalizeSessionDirectory(stored) === normalizeSessionDirectory(filter)
}