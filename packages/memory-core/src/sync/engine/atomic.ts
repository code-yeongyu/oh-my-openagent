// Every durable write of the engine goes through here: write a temporary file in the target's
// own directory, fsync it, rename it over the target, fsync the directory. A crash at any
// instant leaves either the old file or the new one, never a half-written one.

import { randomBytes } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "../../fs/resilient"
import { basename, dirname, join } from "node:path"

import { syncJournalDirectory, syncJournalFile } from "../../journal/fsync"

export const TEMP_MARK = ".omo-sync-tmp-"

export async function writeAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const dir = dirname(path)
  await mkdir(dir, { recursive: true })
  const temp = join(dir, `${TEMP_MARK}${basename(path)}.${randomBytes(6).toString("hex")}`)
  try {
    await writeFile(temp, data)
    await syncJournalFile(temp)
    await rename(temp, path)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
  await syncJournalDirectory(dir)
}

export async function removeAtomic(path: string): Promise<void> {
  await rm(path, { force: true })
  await syncJournalDirectory(dirname(path))
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  let text: string
  try {
    text = await readFile(path, "utf8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return fallback
    throw error
  }
  return JSON.parse(text) as T
}

export function writeJson(path: string, value: unknown): Promise<void> {
  return writeAtomic(path, `${JSON.stringify(value)}\n`)
}
