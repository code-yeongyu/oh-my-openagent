import { constants, closeSync, openSync, writeSync } from "fs"
import { getRegistryPath, MAX_AGE_MS, SECURE_FILE_MODE } from "./session-registry-paths"
import { withRegistryLock, withRegistryLockOrWait } from "./session-registry-lock"
import {
  ensureRegistryDir,
  readAllMappingsUnsafe,
  rewriteRegistryUnsafe,
} from "./session-registry-storage"
import type { SessionMapping } from "./session-registry-types"

export type { SessionMapping } from "./session-registry-types"

export function registerMessage(mapping: SessionMapping): boolean {
  return withRegistryLockOrWait(
    () => {
      ensureRegistryDir()
      const line = JSON.stringify(mapping) + "\n"
      const fd = openSync(
        getRegistryPath(),
        constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT,
        SECURE_FILE_MODE,
      )
      try {
        writeSync(fd, line)
      } finally {
        closeSync(fd)
      }
      return true
    },
    () => {
      console.warn(
        "[notifications] session registry lock unavailable; skipping reply correlation write",
      )
      return false
    },
  )
}

export function loadAllMappings(): SessionMapping[] {
  return withRegistryLockOrWait(
    () => readAllMappingsUnsafe(),
    () => [],
  )
}

export function lookupByMessageId(platform: string, messageId: string): SessionMapping | null {
  const mappings = loadAllMappings()
  return mappings.find((mapping) => mapping.platform === platform && mapping.messageId === messageId) || null
}

export function removeSession(sessionId: string): void {
  withRegistryLock(
    () => {
      const mappings = readAllMappingsUnsafe()
      const filtered = mappings.filter((mapping) => mapping.sessionId !== sessionId)
      if (filtered.length === mappings.length) return
      rewriteRegistryUnsafe(filtered)
    },
    () => {},
  )
}

export function removeMessagesByPane(paneId: string): void {
  withRegistryLock(
    () => {
      const mappings = readAllMappingsUnsafe()
      const filtered = mappings.filter((mapping) => mapping.tmuxPaneId !== paneId)
      if (filtered.length === mappings.length) return
      rewriteRegistryUnsafe(filtered)
    },
    () => {},
  )
}

export function pruneStale(): void {
  withRegistryLock(
    () => {
      const now = Date.now()
      const mappings = readAllMappingsUnsafe()
      const filtered = mappings.filter((mapping) => {
        const age = now - new Date(mapping.createdAt).getTime()
        return age < MAX_AGE_MS
      })
      if (filtered.length === mappings.length) return
      rewriteRegistryUnsafe(filtered)
    },
    () => {},
  )
}
