import { lstat } from "node:fs/promises"

export async function fileExistsStrict(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (isNodeErrorWithCode(error) && error.code === "ENOENT") return false
    throw error
  }
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function isNodeErrorWithCode(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error
}
