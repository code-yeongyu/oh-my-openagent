import { lstat, readlink, realpath, rename, unlink, writeFile } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"

const RENAME_RETRY_DELAYS_MS = [10, 25, 50] as const
const RETRIABLE_RENAME_CODES = new Set(["EPERM", "EBUSY"])

export async function writeFileAtomic(targetPath: string, data: string): Promise<void> {
  const writeTarget = await resolveSymlinkTarget(targetPath)
  const temporaryPath = join(dirname(writeTarget), `.tmp-${basename(writeTarget)}-${process.pid}-${Date.now()}`)
  await writeFile(temporaryPath, data)
  try {
    await renameWithRetry(temporaryPath, writeTarget)
  } catch (error) {
    await unlink(temporaryPath).catch((unlinkError: unknown) => {
      if (unlinkError instanceof Error) return
      return
    })
    throw error
  }
}

async function resolveSymlinkTarget(targetPath: string): Promise<string> {
  try {
    const linkStats = await lstat(targetPath)
    if (!linkStats.isSymbolicLink()) return targetPath
  } catch (error) {
    if (error instanceof Error) return targetPath
    return targetPath
  }

  try {
    return await realpath(targetPath)
  } catch (error) {
    if (!(error instanceof Error)) throw error
    const linkValue = await readlink(targetPath)
    return isAbsolute(linkValue) ? linkValue : resolve(dirname(targetPath), linkValue)
  }
}

async function renameWithRetry(fromPath: string, toPath: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(fromPath, toPath)
      return
    } catch (error) {
      if (!isRetriableRenameError(error) || attempt >= RENAME_RETRY_DELAYS_MS.length) {
        throw error
      }
      await delay(RENAME_RETRY_DELAYS_MS[attempt] ?? 0)
    }
  }
}

function isRetriableRenameError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false
  return typeof error.code === "string" && RETRIABLE_RENAME_CODES.has(error.code)
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}
