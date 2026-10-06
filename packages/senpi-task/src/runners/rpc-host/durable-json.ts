import { randomUUID } from "node:crypto"
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs"
import { dirname } from "node:path"

/**
 * The two small JSON files the task host path keeps beside the shards (the agent-dir store index and
 * a shard's sidecar) are replaced whole: written to a sibling, fsynced, then renamed over the old
 * one, so a reader sees either the previous file or the next - never a torn one. The parent directory
 * is fsynced after the rename so the new name itself survives a crash.
 */

export interface DurableJsonFs {
  /** The file's text, or undefined when it does not exist. Any other read error throws. */
  readonly read: (path: string) => string | undefined
  readonly write: (path: string, text: string) => void
}

export const DURABLE_JSON_FS: DurableJsonFs = { read: readTextIfPresent, write: writeTextDurably }

// A holder of one of these files' locks rewrites and fsyncs the whole file, which a loaded host - a busy
// Windows runner with a real-time scanner inspecting the staged file - stretches past a second while the
// holder is alive and progressing. The record lock's default budget is sized for a sub-10ms record
// read-modify-write; a waiter here must outlast a slow durable write and give up only on a stalled one.
export const DURABLE_JSON_LOCK_OPTIONS = { holderWaitMs: 10_000 } as const

export function readTextIfPresent(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
    throw error
  }
}

export function writeTextDurably(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const staging = `${path}.${process.pid}.${randomUUID()}.tmp`
  const fd = openSync(staging, "w", 0o600)
  try {
    writeSync(fd, text)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  try {
    renameSync(staging, path)
  } catch (error) {
    rmSync(staging, { force: true })
    throw error
  }
  syncDirectory(dirname(path))
}

// Windows cannot open a directory for fsync; NTFS journals the rename itself. A filesystem that refuses
// to fsync a directory (EINVAL/ENOTSUP) offers no stronger guarantee to ask for.
function syncDirectory(directory: string): void {
  if (process.platform === "win32") return
  const fd = openSync(directory, "r")
  try {
    fsyncSync(fd)
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined
    if (code !== "EINVAL" && code !== "ENOTSUP") throw error
  } finally {
    closeSync(fd)
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
