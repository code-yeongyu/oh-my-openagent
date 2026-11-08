import { join } from "node:path"

import { chmod, lstat, readdir, rm } from "./resilient"

const RETRYABLE_ON_WIN32 = new Set(["EPERM", "EACCES", "EBUSY", "ENOTEMPTY"])
// darwin reports a read-only directory's undeletable children as ENOTEMPTY from the final rmdir.
const PERMISSION_CODES = new Set(["EPERM", "EACCES", "ENOTEMPTY"])
const WIN32_BUSY_RETRIES = 5

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined
}

/**
 * Removes a file or directory tree, tolerating read-only content (H2). Reflection and facts runs
 * chmod their payload files to 0o400; on POSIX that never blocks an unlink, but on win32 it sets the
 * read-only attribute and `unlink` fails with EPERM, and a 0o500 directory blocks removal on every
 * platform (darwin surfaces it as ENOTEMPTY). On a permission failure the tree is made writable
 * (files 0o600, directories 0o700) and removed once more. ENOENT is success.
 */
export async function removeTree(path: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true })
    return
  } catch (error) {
    const code = errorCode(error)
    const retryable = platform === "win32" ? RETRYABLE_ON_WIN32.has(code ?? "") : PERMISSION_CODES.has(code ?? "")
    if (!retryable) throw error
  }
  await makeWritable(path)
  const attempts = platform === "win32" ? WIN32_BUSY_RETRIES : 1
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true })
      return
    } catch (error) {
      if (attempt >= attempts || errorCode(error) !== "EBUSY") throw error
    }
  }
}

async function makeWritable(path: string): Promise<void> {
  const stats = await lstat(path).catch((error: unknown) => {
    if (errorCode(error) === "ENOENT") return undefined
    throw error
  })
  if (stats === undefined || stats.isSymbolicLink()) return
  if (!stats.isDirectory()) {
    await chmod(path, 0o600)
    return
  }
  await chmod(path, 0o700)
  for (const name of await readdir(path)) await makeWritable(join(path, name))
}
