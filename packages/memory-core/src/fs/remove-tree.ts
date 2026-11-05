// Removal that tolerates read-only files (H2 of #10144/#11976). Run dirs hold payload files chmodded
// 0o400; POSIX unlinks them through the writable parent, but on win32 the read-only attribute makes
// unlink fail with EPERM until it is cleared, so a failed pass clears the modes and retries once.

import { join } from "node:path"

import { chmod, lstat, readdir, rm } from "./resilient"

const WRITABLE_FILE = 0o600
const WRITABLE_DIR = 0o700
const BUSY_RETRIES = 3

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined
}

async function makeWritable(path: string): Promise<void> {
  const status = await lstat(path).catch(() => undefined)
  if (status === undefined || status.isSymbolicLink()) return
  if (!status.isDirectory()) {
    await chmod(path, WRITABLE_FILE).catch(() => {})
    return
  }
  await chmod(path, WRITABLE_DIR).catch(() => {})
  for (const name of await readdir(path).catch(() => [] as string[])) await makeWritable(join(path, name))
}

export async function removeTree(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true, maxRetries: process.platform === "win32" ? BUSY_RETRIES : 0 })
    return
  } catch (error) {
    const code = errorCode(error)
    if (code === "ENOENT") return
    if (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") throw error
  }
  await makeWritable(path)
  await rm(path, { recursive: true, force: true, maxRetries: process.platform === "win32" ? BUSY_RETRIES : 0 })
}
