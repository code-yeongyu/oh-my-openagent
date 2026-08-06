import { join } from "node:path"
import { resolveXdgDataDir } from "@oh-my-opencode/utils"

export const SECURE_FILE_MODE = 0o600
export const MAX_AGE_MS = 24 * 60 * 60 * 1000
export const LOCK_TIMEOUT_MS = 2000
export const LOCK_WAIT_TIMEOUT_MS = 4000
export const LOCK_RETRY_MS = 20
export const LOCK_STALE_MS = 10000

type RegistryPaths = {
  readonly openClawStorageDir: string
  readonly registryPath: string
  readonly registryLockPath: string
}

let cachedRegistryPaths: RegistryPaths | null = null

function resolveRegistryPaths(): RegistryPaths {
  if (cachedRegistryPaths !== null) return cachedRegistryPaths

  const openClawStorageDir = join(getOpenCodeStorageDir(), "openclaw")
  cachedRegistryPaths = {
    openClawStorageDir,
    registryPath: join(openClawStorageDir, "reply-session-registry.jsonl"),
    registryLockPath: join(openClawStorageDir, "reply-session-registry.lock"),
  }
  return cachedRegistryPaths
}

export function getOpenCodeStorageDir(): string {
  return join(resolveXdgDataDir("opencode"), "opencode", "storage")
}

export function getOpenClawStorageDir(): string {
  return resolveRegistryPaths().openClawStorageDir
}

export function getRegistryPath(): string {
  return resolveRegistryPaths().registryPath
}

export function getRegistryLockPath(): string {
  return resolveRegistryPaths().registryLockPath
}
