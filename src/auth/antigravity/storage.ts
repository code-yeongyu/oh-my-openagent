import { promises as fs } from "node:fs"
import { join, dirname } from "node:path"
import type { AccountStorage } from "./types"
import { getDataDir as getSharedDataDir } from "../../shared/data-path"

export function getDataDir(): string {
  return join(getSharedDataDir(), "opencode")
}

export function getStoragePath(): string {
  return join(getDataDir(), "oh-my-opencode-accounts.json")
}

export async function loadAccounts(path?: string): Promise<AccountStorage | null> {
  const storagePath = path ?? getStoragePath()

  try {
    const content = await fs.readFile(storagePath, "utf-8")
    const data = JSON.parse(content) as unknown

    if (!isValidAccountStorage(data)) {
      return null
    }

    return data
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code
    if (errorCode === "ENOENT") {
      return null
    }
    if (error instanceof SyntaxError) {
      return null
    }
    throw error
  }
}

export async function saveAccounts(storage: AccountStorage, path?: string): Promise<void> {
  const storagePath = path ?? getStoragePath()

  await fs.mkdir(dirname(storagePath), { recursive: true })

  const content = JSON.stringify(storage, null, 2)
  const tempPath = `${storagePath}.tmp.${process.pid}.${Date.now()}`
  await fs.writeFile(tempPath, content, { encoding: "utf-8", mode: 0o600 })
  try {
    await fs.rename(tempPath, storagePath)
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {})
    throw error
  }
}

function isValidAccountStorage(data: unknown): data is AccountStorage {
  if (typeof data !== "object" || data === null) {
    return false
  }

  const obj = data as Record<string, unknown>

  if (typeof obj.version !== "number") {
    return false
  }

  if (!Array.isArray(obj.accounts)) {
    return false
  }

  if (typeof obj.activeIndex !== "number") {
    return false
  }

  return true
}
