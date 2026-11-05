// The resume cursor of an interrupted pass (design 6, N3): `runtime/retention.json` holds ONLY a
// cursor, is written only when a pass stops early, and is deleted when a pass completes. The
// completion stamp lives in the memory repo's git config (`omo.retentionAt`), written by the caller.

import { randomUUID } from "node:crypto"
import { join } from "node:path"

import { readFile, rename, rm, writeFile } from "../fs/resilient"
import type { RetentionCursor } from "./budget"

export const RETENTION_STAMP_CONFIG_KEY = "omo.retentionAt"
const CURSOR_FILE = "retention.json"

export function retentionCursorPath(runtimeDir: string): string {
  return join(runtimeDir, CURSOR_FILE)
}

export async function readRetentionCursor(runtimeDir: string): Promise<RetentionCursor | undefined> {
  try {
    const parsed = JSON.parse(await readFile(retentionCursorPath(runtimeDir), "utf8")) as { readonly cursor?: { readonly store?: unknown; readonly lastName?: unknown } }
    const cursor = parsed.cursor
    if (typeof cursor?.store !== "string") return undefined
    return typeof cursor.lastName === "string" ? { store: cursor.store, lastName: cursor.lastName } : { store: cursor.store }
  } catch {
    return undefined
  }
}

export async function writeRetentionCursor(runtimeDir: string, cursor: RetentionCursor): Promise<void> {
  const target = retentionCursorPath(runtimeDir)
  const temporary = `${target}.tmp-${randomUUID()}`
  try {
    await writeFile(temporary, `${JSON.stringify({ version: 1, cursor })}\n`, { encoding: "utf8", mode: 0o600 })
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

export async function clearRetentionCursor(runtimeDir: string): Promise<void> {
  await rm(retentionCursorPath(runtimeDir), { force: true })
}
