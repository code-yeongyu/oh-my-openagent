import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { z } from "zod"

// The credential itself lives only in the OS secret store, which an engine host cannot read synchronously and
// which may stop on an approval dialog (#11262). The credential store therefore keeps this non-secret record of
// WHICH account is signed in next to the `omo logout` marker; the presenter account authority reads only this.
const recordSchema = z.object({ accountId: z.string().min(1), credentialGeneration: z.string().min(1) })
export type AccountRecord = z.infer<typeof recordSchema>

export const accountRecordPath = (home: string, credential: string): string =>
  join(home, ".omo", "account-state", `${credential}.account.json`)

/** A missing, unreadable or malformed record reads as no account: the caller fails closed as signed out. */
export function readAccountRecord(path: string): AccountRecord | null {
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return null
  }
  const parsed = recordSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export async function writeAccountRecord(path: string, record: AccountRecord): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const staging = `${path}.${process.pid}.tmp`
  await writeFile(staging, JSON.stringify(record), { mode: 0o600 })
  await rename(staging, path)
}

export const clearAccountRecord = (path: string): Promise<void> => rm(path, { force: true })
