import { rm, rmSync } from "node:fs"
import { promisify } from "node:util"

// Bun parses fs.rm's maxRetries/retryDelay but never retries (oven-sh/bun#41480), so a Windows
// file still held open for a moment after its process exits fails the cleanup on the first EBUSY.
const TRANSIENT_CODES = new Set(["EBUSY", "EPERM", "EMFILE", "ENFILE", "ENOTEMPTY"])

export type RemoveTreeOptions = {
  readonly maxRetries?: number
  readonly retryDelay?: number
}

type RemoveAsync = (path: string) => Promise<void>
type RemoveSync = (path: string) => void

const rmAsync = promisify(rm)
const removeRecursive: RemoveAsync = (path) => rmAsync(path, { recursive: true, force: true })
const removeRecursiveSync: RemoveSync = (path) => rmSync(path, { recursive: true, force: true })

function isTransient(error: unknown): boolean {
  return error instanceof Error && "code" in error && typeof error.code === "string" && TRANSIENT_CODES.has(error.code)
}

function blockFor(milliseconds: number): void {
  if (typeof Bun !== "undefined") {
    Bun.sleepSync(milliseconds)
    return
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

export async function removeTree(path: string, options: RemoveTreeOptions = {}, remove: RemoveAsync = removeRecursive): Promise<void> {
  const maxRetries = options.maxRetries ?? 10
  const retryDelay = options.retryDelay ?? 100
  for (let attempt = 0; ; attempt++) {
    try {
      await remove(path)
      return
    } catch (error) {
      if (!isTransient(error) || attempt >= maxRetries) throw error
      await new Promise((resolve) => setTimeout(resolve, retryDelay * (attempt + 1)))
    }
  }
}

export function removeTreeSync(path: string, options: RemoveTreeOptions = {}, remove: RemoveSync = removeRecursiveSync): void {
  const maxRetries = options.maxRetries ?? 10
  const retryDelay = options.retryDelay ?? 100
  for (let attempt = 0; ; attempt++) {
    try {
      remove(path)
      return
    } catch (error) {
      if (!isTransient(error) || attempt >= maxRetries) throw error
      blockFor(retryDelay * (attempt + 1))
    }
  }
}
