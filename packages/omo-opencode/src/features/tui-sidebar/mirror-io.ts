import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

import { writeFileAtomically } from "../../shared/write-file-atomically"
import { READER_LEASE_MS, READER_LEASE_TOUCH_MS, STALE_MS } from "./constants"
import { canonicalProjectDir, mirrorFilePath, mirrorReaderLeasePath } from "./mirror-path"
import { parseSnapshot } from "./snapshot-schema"
import type { TuiRuntimeSnapshot } from "./snapshot-schema"

export function writeMirror(projectDir: string, snapshot: TuiRuntimeSnapshot): void {
  const filePath = mirrorFilePath(projectDir)
  const content = JSON.stringify(snapshot)

  mkdirSync(dirname(filePath), { recursive: true })
  writeFileAtomically(filePath, content, { mode: 0o600 })
}

export function readMirror(projectDir: string): TuiRuntimeSnapshot | null {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(mirrorFilePath(projectDir), "utf-8"))
  } catch (error) {
    if (error instanceof Error) {
      return null
    }
    throw error
  }

  const snapshot = parseSnapshot(raw)
  if (snapshot === null) {
    return null
  }
  if (canonicalProjectDir(snapshot.projectDir) !== canonicalProjectDir(projectDir)) {
    return null
  }
  if (Date.now() - snapshot.updatedAt > STALE_MS) {
    return null
  }
  return snapshot
}

const leaseTouchedAt = new Map<string, number>()

/** Called by the TUI before it reads the mirror: marks that someone is reading this project's mirror. */
export function touchReaderLease(projectDir: string, now: number = Date.now()): void {
  const filePath = mirrorReaderLeasePath(projectDir)
  if (now - (leaseTouchedAt.get(filePath) ?? Number.NEGATIVE_INFINITY) < READER_LEASE_TOUCH_MS) return
  leaseTouchedAt.set(filePath, now)
  try {
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, String(now), { mode: 0o600 })
  } catch (error) {
    if (!(error instanceof Error)) throw error
  }
}

/** True while a TUI has read this project's mirror recently (lease mtime within READER_LEASE_MS). */
export function readerLeaseFresh(projectDir: string, now: number = Date.now()): boolean {
  return readerLeaseFreshAt(mirrorReaderLeasePath(projectDir), now)
}

/** Same check on a lease path resolved once (resolving it costs a realpath and a hash per call). */
export function readerLeaseFreshAt(leasePath: string, now: number = Date.now()): boolean {
  try {
    return now - statSync(leasePath).mtimeMs <= READER_LEASE_MS
  } catch (error) {
    if (error instanceof Error) return false
    throw error
  }
}

export function resetReaderLeaseThrottle(): void {
  leaseTouchedAt.clear()
}
