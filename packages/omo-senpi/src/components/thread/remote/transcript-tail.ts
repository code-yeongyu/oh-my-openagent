import type { ThreadTranscriptEntry } from "../reader"
import { ENTRY_WINDOW_MESSAGES, entryIdOf, messageOf, type EntryWindow } from "../paged-reader"
import { replyData } from "./remote-ops"
import type { JsonObject, RemoteCommandOutcome, RemoteSessionsPort } from "./ports"

/**
 * The newest entries of a session another device holds, read in `get_entries` pages (#14047) and kept per (device,
 * session) on this side: a later read asks the holder only for the entries after the newest one it kept (`since`), so
 * an unchanged transcript costs one empty page and a grown one only its new entries.
 */

// One page's bounds on the holder. Sessions interleave bookkeeping entries with messages (measured: 223 entries held a
// window's 60 messages), so a page asks for several windows' worth of entries; a window needs a second page only when
// its newest entries pass either bound.
const PAGE_BYTES = 512 * 1024
const PAGE_ENTRIES = 256
// Sessions kept per port, least recently read dropped first.
const KEPT_SESSIONS = 32

// What an engine without `get_entries` paging (or one that refuses its fields) answers: read the whole transcript.
const NO_PAGING: ReadonlySet<string> = new Set([
  "invalid_argument",
  "invalid_request",
  "unknown_type",
  "unknown_command",
  "unsupported",
  "method_unclassified",
  "malformed",
])
// The engine's answer for a `since`/`before` entry that is no longer in the session (a rewritten file).
const ENTRY_GONE = "not_found"

export type EntryWindowRead =
  | { readonly kind: "ok"; readonly window: EntryWindow }
  | { readonly kind: "unsupported" }
  | { readonly kind: "failed"; readonly outcome: Exclude<RemoteCommandOutcome, { readonly kind: "ok" }> }

type Page = { readonly entries: ThreadTranscriptEntry[]; readonly leaf: string | null; readonly more: boolean }

const kept = new WeakMap<RemoteSessionsPort, Map<string, EntryWindow>>()
const unpaged = new WeakMap<RemoteSessionsPort, Set<string>>()

const idOf = entryIdOf
const messageCount = (entries: readonly ThreadTranscriptEntry[]): number =>
  entries.reduce((count, entry) => (messageOf(entry) === undefined ? count : count + 1), 0)

// The entries from the window's oldest message on: everything older answers no read.
function trimToWindow(entries: readonly ThreadTranscriptEntry[]): readonly ThreadTranscriptEntry[] {
  let seen = 0
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry !== undefined && messageOf(entry) !== undefined) seen += 1
    if (seen === ENTRY_WINDOW_MESSAGES) return entries.slice(index)
  }
  return entries
}

function pageOf(data: JsonObject): Page {
  const listed = data["entries"]
  const entries = Array.isArray(listed)
    ? listed.filter(
        (entry): entry is ThreadTranscriptEntry => typeof entry === "object" && entry !== null && !Array.isArray(entry),
      )
    : []
  const leaf = data["leafId"]
  return { entries, leaf: typeof leaf === "string" ? leaf : null, more: data["hasMore"] === true }
}

export async function readEntryWindow(
  port: RemoteSessionsPort,
  device: string,
  sessionId: string,
): Promise<EntryWindowRead> {
  if (unpaged.get(port)?.has(device) === true) return { kind: "unsupported" }
  const sessions = kept.get(port) ?? new Map<string, EntryWindow>()
  kept.set(port, sessions)
  const key = `${device}\0${sessionId}`
  const page = async (rpc: JsonObject): Promise<Page | Exclude<RemoteCommandOutcome, { readonly kind: "ok" }>> => {
    const outcome = await port.sessionCommand(device, sessionId, {
      type: "get_entries",
      sessionId,
      maxBytes: PAGE_BYTES,
      ...rpc,
    })
    return outcome.kind === "ok" ? pageOf(replyData(outcome.response)) : outcome
  }
  const failed = (outcome: Exclude<RemoteCommandOutcome, { readonly kind: "ok" }>): EntryWindowRead => {
    if (outcome.kind !== "refused" || !NO_PAGING.has(outcome.reason)) return { kind: "failed", outcome }
    unpaged.set(port, (unpaged.get(port) ?? new Set()).add(device))
    sessions.delete(key)
    return { kind: "unsupported" }
  }

  let entries: ThreadTranscriptEntry[] | undefined
  let complete = false
  let leaf: string | null = null
  const previous = sessions.get(key)
  const newest = idOf(previous?.entries.at(-1))
  if (previous !== undefined && newest !== undefined) {
    entries = [...previous.entries]
    complete = previous.complete
    leaf = previous.leaf
    for (let since = newest, more = true; more; ) {
      const next = await page({ since })
      if ("kind" in next) {
        if (next.kind === "refused" && next.reason === ENTRY_GONE) {
          entries = undefined
          break
        }
        return failed(next)
      }
      entries.push(...next.entries)
      leaf = next.leaf
      since = idOf(next.entries.at(-1)) ?? since
      more = next.more && next.entries.length > 0
    }
  }
  if (entries === undefined) {
    const first = await page({ tail: PAGE_ENTRIES })
    if ("kind" in first) return failed(first)
    entries = first.entries
    complete = !first.more
    leaf = first.leaf
  }
  while (messageCount(entries) < ENTRY_WINDOW_MESSAGES && !complete) {
    const before = idOf(entries[0])
    if (before === undefined) break
    const older = await page({ before, tail: PAGE_ENTRIES })
    if ("kind" in older) return failed(older)
    entries.unshift(...older.entries)
    complete = !older.more || older.entries.length === 0
  }
  const windowEntries = trimToWindow(entries)
  const window: EntryWindow = { entries: windowEntries, complete: complete && windowEntries.length === entries.length, leaf }
  sessions.delete(key)
  sessions.set(key, window)
  for (const oldest of sessions.keys()) {
    if (sessions.size <= KEPT_SESSIONS) break
    sessions.delete(oldest)
  }
  return { kind: "ok", window }
}
