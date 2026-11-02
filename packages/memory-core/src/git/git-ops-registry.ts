import { randomUUID } from "node:crypto"
import { join } from "node:path"

import { lstat, mkdir, open, rename, unlink } from "../fs/resilient"

// The Windows operation registry (design v4.2 sections 6.4, 7.1, 12): one `<locks>\git-ops\<uuid>.op` JSON entry per
// memory-core git command, written only once its helper has joined and verified the floor job, and before that helper
// may run git. Written atomically (temp, fsync, rename) and deleted by the writer only under the activity gate.
const GIT_OPS_DIRNAME = "git-ops"

export type GitOpEntry = {
  readonly version: 1
  readonly state: "started"
  readonly op: string
  readonly job: string
  readonly launcher: { readonly pid: number; readonly process_start: string }
  readonly helper: { readonly pid: number; readonly created: string }
  readonly writer_nonce: string | null
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined
}

function gitOpEntryPath(locksDirectory: string, op: string): string {
  return join(locksDirectory, GIT_OPS_DIRNAME, `${op}.op`)
}

export async function gitOpEntryExists(locksDirectory: string, op: string): Promise<boolean> {
  try {
    await lstat(gitOpEntryPath(locksDirectory, op))
    return true
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false
    throw error
  }
}

export async function writeStartedGitOpEntry(locksDirectory: string, entry: GitOpEntry): Promise<void> {
  const directory = join(locksDirectory, GIT_OPS_DIRNAME)
  try {
    await mkdir(directory)
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error
  }
  const temporary = join(directory, `${entry.op}.op.tmp-${randomUUID()}`)
  const handle = await open(temporary, "wx", 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(entry)}\n`, "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(temporary, gitOpEntryPath(locksDirectory, entry.op))
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

export async function deleteGitOpEntry(locksDirectory: string, op: string): Promise<void> {
  try {
    await unlink(gitOpEntryPath(locksDirectory, op))
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error
  }
}
