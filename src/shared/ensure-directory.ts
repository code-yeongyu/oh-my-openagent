import { mkdirSync } from "node:fs"

/**
 * Ensure a directory exists, creating it recursively if needed.
 * Replaces scattered `mkdirSync(path, { recursive: true })` calls.
 */
export function ensureDirectory(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true })
}
