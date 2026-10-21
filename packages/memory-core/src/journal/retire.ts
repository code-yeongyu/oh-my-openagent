// Journal retirement: the size bound for transcript journals.
//
// A transcript journal exists to feed reflection and facts extraction. Once both have consumed it (or a
// storage budget evicts it), its rows have no further reader, yet the file used to stay forever. Retiring
// keeps only what dedupe needs: one 16-hex key per message the journal ever held, in `retired.ids`
// (17 bytes per message). The transcript is deleted and state.json is reset, so a resumed session that
// replays its whole branch appends only the messages it never journaled before.

import { createHash, randomUUID } from "node:crypto"
import { join } from "node:path"

import { open, readFile, rename, rm, stat, unlink, writeFile } from "../fs/resilient"
import { initialReflectionState } from "./cursor"
import { JournalLockTimeoutError, withLocalJournalLock, type JournalLock } from "./lock"

export const RETIRED_IDS_FILE = "retired.ids"
const TRANSCRIPT = "transcript.jsonl"
const STATE = "state.json"
const LOCK = "state.lock"
// The transcript is read in fixed chunks so a legacy multi-GB journal never lands in one string and the
// event loop gets a turn between chunks.
const READ_CHUNK_BYTES = 256 * 1024

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

/** Stable short key of a message id; collisions at 64 bits are negligible for one conversation. */
export function retiredMessageKey(messageId: string): string {
  return createHash("sha256").update(messageId).digest("hex").slice(0, 16)
}

/** Message keys a retired journal remembers; empty when the journal was never retired. */
export async function readRetiredMessageKeys(journalDir: string): Promise<ReadonlySet<string>> {
  let raw: string
  try {
    raw = await readFile(join(journalDir, RETIRED_IDS_FILE), "utf8")
  } catch (error) {
    if (errorCode(error) === "ENOENT") return new Set()
    throw error
  }
  const keys = new Set<string>()
  for (const line of raw.split("\n")) {
    const key = line.trim()
    if (/^[0-9a-f]{16}$/.test(key)) keys.add(key)
  }
  return keys
}

/** Streams the message ids out of a transcript without holding the file in memory. */
async function collectMessageKeys(transcriptPath: string, into: Set<string>): Promise<number> {
  let handle
  try {
    handle = await open(transcriptPath, "r")
  } catch (error) {
    if (errorCode(error) === "ENOENT") return 0
    throw error
  }
  let bytes = 0
  try {
    const buffer = Buffer.alloc(READ_CHUNK_BYTES)
    let carry = ""
    const take = (line: string): void => {
      if (line.trim().length === 0) return
      try {
        const parsed: unknown = JSON.parse(line)
        if (parsed !== null && typeof parsed === "object") {
          const id = Reflect.get(parsed, "source_message_id")
          if (typeof id === "string" && id.length > 0) into.add(retiredMessageKey(id))
        }
      } catch {
        // A torn trailing line carries no message the journal finished recording.
      }
    }
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, READ_CHUNK_BYTES, null)
      if (bytesRead === 0) break
      bytes += bytesRead
      const lines = (carry + buffer.subarray(0, bytesRead).toString("utf8")).split("\n")
      carry = lines.pop() ?? ""
      for (const line of lines) take(line)
    }
    take(carry)
  } finally {
    await handle.close()
  }
  return bytes
}

async function publish(path: string, contents: string): Promise<void> {
  const temporary = `${path}.tmp-${randomUUID()}`
  await writeFile(temporary, contents, { encoding: "utf8", mode: 0o600 })
  try {
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

export type RetireJournalResult =
  | { readonly status: "retired"; readonly messages: number; readonly freedBytes: number }
  | { readonly status: "locked" | "missing" | "refused" }

export type RetireJournalOptions = {
  readonly lock?: JournalLock
  /**
   * Runs under the journal lock right before anything is removed; false leaves the journal untouched.
   * Holding the lock across it means no append can land between the caller's release and the retirement.
   */
  readonly beforeRetire?: () => Promise<boolean>
}

/**
 * Retires one journal under its lock. Order is crash-safe: the merged key file lands first, so an
 * interrupted retirement still dedupes; the transcript goes next; state.json is reset last (an empty
 * transcript already derives zero steps, so a stale state file is harmless).
 */
export async function retireTranscriptJournal(
  journalDir: string,
  options: RetireJournalOptions = {},
): Promise<RetireJournalResult> {
  try {
    await stat(journalDir)
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { status: "missing" }
    throw error
  }
  const lock = options.lock ?? withLocalJournalLock
  try {
    return await lock(join(journalDir, LOCK), async () => {
      if (options.beforeRetire !== undefined && !(await options.beforeRetire())) return { status: "refused" as const }
      const transcriptPath = join(journalDir, TRANSCRIPT)
      const keys = new Set(await readRetiredMessageKeys(journalDir))
      const before = keys.size
      const freedBytes = await collectMessageKeys(transcriptPath, keys)
      await publish(join(journalDir, RETIRED_IDS_FILE), keys.size === 0 ? "" : `${[...keys].join("\n")}\n`)
      await unlink(transcriptPath).catch((error: unknown) => {
        if (errorCode(error) !== "ENOENT") throw error
      })
      await publish(join(journalDir, STATE), `${JSON.stringify(initialReflectionState(), null, 2)}\n`)
      return { status: "retired" as const, messages: keys.size - before, freedBytes }
    })
  } catch (error) {
    if (error instanceof JournalLockTimeoutError) return { status: "locked" }
    throw error
  }
}
