// The adapter's persisted state: ids and cursors only, never message text, captions, transcripts
// or file names (inbound text lives only in the session-gateway store; Design record "Data
// handling"). Kept in a 0600 file inside a 0700 directory:
// - `offset`: the next update_id listen asks for; every update below it was handed to the caller.
// - `confirmed`: the offset of the latest getUpdates the adapter sent. Telegram forgets an update
//   once a request with a higher offset arrives, so updates from `confirmed` on may still be held
//   by Telegram; catchUp after a restart re-reads them from here (same update, same event_id).
// - `seen`: the event ids already handed to the caller (bounded by `maxEvents` / `maxAgeMs`), so a
//   re-read after a restart can tell a replay from an update that arrived while the adapter was down.
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export type SeenEvent = { event_id: string; at: string }
export type TelegramState = { offset: number; confirmed: number; seen: readonly SeenEvent[] }
export type JournalRetention = { maxEvents: number; maxAgeMs: number }

export const DEFAULT_RETENTION: JournalRetention = { maxEvents: 500, maxAgeMs: 24 * 60 * 60 * 1000 }

const EMPTY: TelegramState = { offset: 0, confirmed: 0, seen: [] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isCursor(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
}

function isSeen(value: unknown): value is SeenEvent {
  return isRecord(value) && typeof value.event_id === "string" && typeof value.at === "string"
}

export class TelegramStateFile {
  constructor(
    readonly path: string,
    readonly retention: JournalRetention = DEFAULT_RETENTION,
  ) {}

  async load(onCorrupt: (reason: string) => void): Promise<TelegramState> {
    let raw: string
    try {
      raw = await readFile(this.path, "utf8")
    } catch (error) {
      if (isRecord(error) && error.code === "ENOENT") return EMPTY
      throw error
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      onCorrupt("state file is not JSON")
      return EMPTY
    }
    if (!isRecord(parsed) || !isCursor(parsed.offset)) {
      onCorrupt("state file has no valid offset")
      return EMPTY
    }
    const offset = parsed.offset
    const confirmed = isCursor(parsed.confirmed) && parsed.confirmed <= offset ? parsed.confirmed : offset
    const seen = Array.isArray(parsed.seen) ? parsed.seen.filter(isSeen).map(({ event_id, at }) => ({ event_id, at })) : []
    return { offset, confirmed, seen }
  }

  prune<T extends { at: string }>(entries: readonly T[], now: number): T[] {
    const oldest = now - this.retention.maxAgeMs
    return entries.filter((entry) => Date.parse(entry.at) >= oldest).slice(-this.retention.maxEvents)
  }

  async save(state: TelegramState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const temp = `${this.path}.${process.pid}.${Date.now().toString(36)}.tmp`
    const onDisk: TelegramState = { offset: state.offset, confirmed: state.confirmed, seen: state.seen.map(({ event_id, at }) => ({ event_id, at })) }
    await writeFile(temp, JSON.stringify(onDisk), { mode: 0o600 })
    await chmod(temp, 0o600)
    await rename(temp, this.path)
  }
}
