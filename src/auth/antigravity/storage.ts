import { promises as fs } from "node:fs"
import { join, dirname } from "node:path"
import { homedir } from "node:os"
import type { AccountStorage } from "./types"

export function getDataDir(): string {
  const platform = process.platform

  if (platform === "win32") {
    return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "opencode")
  }

  const xdgData = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share")
  return join(xdgData, "opencode")
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
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null
    }
    return null
  }
}

export async function saveAccounts(storage: AccountStorage, path?: string): Promise<void> {
  const storagePath = path ?? getStoragePath()

  await fs.mkdir(dirname(storagePath), { recursive: true })

  const content = JSON.stringify(storage, null, 2)
  await fs.writeFile(storagePath, content, { encoding: "utf-8", mode: 0o600 })
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
