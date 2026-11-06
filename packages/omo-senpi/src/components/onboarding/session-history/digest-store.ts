import { appendFile, chmod, mkdir, readFile, rm } from "node:fs/promises"
import { join } from "node:path"

import type { SessionDigest } from "./types"

export interface SessionDigestStore {
  put(scanId: string, digest: SessionDigest): Promise<void>
  list(scanId: string): Promise<ReadonlyArray<SessionDigest>>
  drop(scanId: string): Promise<void>
}

const SCAN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

function scanDirectory(stateDir: string, scanId: string): string {
  if (!SCAN_ID.test(scanId) || scanId.includes("..")) throw new Error(`invalid scanId: ${JSON.stringify(scanId)}`)
  return join(stateDir, "onboarding", "scans", scanId)
}

function isMissing(cause: unknown): boolean {
  return cause instanceof Error && "code" in cause && cause.code === "ENOENT"
}

/**
 * Digests held only in this process's memory: nothing reaches disk. The onboarding scan uses it, because
 * nothing may be persisted before the user consents; `drop` (or letting the store go) releases them.
 */
export function createMemorySessionDigestStore(): SessionDigestStore {
  const scans = new Map<string, SessionDigest[]>()
  return {
    async put(scanId, digest) {
      scans.set(scanId, [...(scans.get(scanId) ?? []), digest])
    },
    async list(scanId) {
      return scans.get(scanId) ?? []
    },
    async drop(scanId) {
      scans.delete(scanId)
    },
  }
}

/**
 * Digests stay on this machine under the engine's own state directory (`<stateDir>/onboarding/scans/<scanId>/`,
 * owner-only permissions) and are never sent anywhere; `drop` removes a scan's digests.
 */
export function createSessionDigestStore(options: { readonly stateDir: string }): SessionDigestStore {
  return {
    async put(scanId, digest) {
      const directory = scanDirectory(options.stateDir, scanId)
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await chmod(directory, 0o700)
      const file = join(directory, "digests.jsonl")
      await appendFile(file, `${JSON.stringify(digest)}\n`, { mode: 0o600 })
      await chmod(file, 0o600)
    },
    async list(scanId) {
      const file = join(scanDirectory(options.stateDir, scanId), "digests.jsonl")
      let contents: string
      try {
        contents = await readFile(file, "utf8")
      } catch (cause) {
        if (isMissing(cause)) return []
        throw cause
      }
      return contents
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line): SessionDigest => JSON.parse(line))
    },
    async drop(scanId) {
      await rm(scanDirectory(options.stateDir, scanId), { recursive: true, force: true })
    },
  }
}
