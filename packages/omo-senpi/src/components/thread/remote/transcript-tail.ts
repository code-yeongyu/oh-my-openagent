import type { ContextTail } from "../paged-reader"
import { contextTail } from "./context-tail"
import { replyData } from "./remote-ops"
import type { JsonObject, RemoteCommandOutcome, RemoteSessionsPort, SessionProjector } from "./ports"

/**
 * The context tail of a session another device holds, from its newest entries read in `get_entries` pages (#14047) and
 * kept per (device, session) on this side: a later read asks the holder only for the entries after the newest one it
 * kept (`since`), so an unchanged transcript costs one empty page and a grown one only its new entries. Every read
 * projects the kept entries again along the leaf the holder names, so a branch move or a compaction shows at once.
 */

// One page's bounds on the holder. Sessions interleave bookkeeping entries with messages (measured: 223 entries held a
// window's 60 messages), so a page asks for several windows' worth of entries; a tail needs a second page only when
// its entries pass either bound.
const PAGE_BYTES = 512 * 1024
const PAGE_ENTRIES = 256
// What this side keeps: at most this many bytes of entries per port, and none of a session whose tail alone is larger.
const KEPT_BYTES = 16 * 1024 * 1024
const KEPT_SESSION_BYTES = 4 * 1024 * 1024

// An engine without `get_entries` (a terminal answers `unsupported`): every read of the device takes `get_messages`.
const DEVICE_UNPAGED: ReadonlySet<string> = new Set(["unknown_type", "unknown_command", "unsupported"])
// A page refused for its fields, its route or its size: this read takes `get_messages`, the next one pages again.
const READ_UNPAGED: ReadonlySet<string> = new Set([
  "invalid_argument",
  "invalid_request",
  "malformed",
  "method_unclassified",
  "response_too_large",
  "record_too_large",
  "message_too_long",
])
// The engine's answer for a `since`/`before` entry that is no longer in the session (a rewritten file).
const ENTRY_GONE = "not_found"

export type ContextTailRead =
  | { readonly kind: "ok"; readonly tail: ContextTail }
  | { readonly kind: "unsupported" }
  | { readonly kind: "failed"; readonly outcome: Exclude<RemoteCommandOutcome, { readonly kind: "ok" }> }

type Kept = { readonly entries: JsonObject[]; readonly complete: boolean; readonly bytes: number }
type Page = { readonly entries: JsonObject[]; readonly leaf: string | null; readonly more: boolean }
type Refusal = Exclude<RemoteCommandOutcome, { readonly kind: "ok" }>

const kept = new WeakMap<RemoteSessionsPort, Map<string, Kept>>()
const unpaged = new WeakMap<RemoteSessionsPort, Set<string>>()

const idOf = (entry: JsonObject | undefined): string | undefined =>
  typeof entry?.["id"] === "string" ? entry["id"] : undefined

function pageOf(data: JsonObject): Page {
  const listed = data["entries"]
  const entries = Array.isArray(listed)
    ? listed.filter(
        (entry): entry is JsonObject => typeof entry === "object" && entry !== null && !Array.isArray(entry),
      )
    : []
  const leaf = data["leafId"]
  return { entries, leaf: typeof leaf === "string" ? leaf : null, more: data["hasMore"] === true }
}

function keep(sessions: Map<string, Kept>, key: string, entries: JsonObject[], complete: boolean): void {
  sessions.delete(key)
  const bytes = entries.reduce((total, entry) => total + JSON.stringify(entry).length, 0)
  if (bytes > KEPT_SESSION_BYTES) return
  sessions.set(key, { entries, complete, bytes })
  let total = [...sessions.values()].reduce((sum, session) => sum + session.bytes, 0)
  for (const [oldest, session] of sessions) {
    if (total <= KEPT_BYTES) break
    sessions.delete(oldest)
    total -= session.bytes
  }
}

export async function readContextTail(
  port: RemoteSessionsPort,
  device: string,
  sessionId: string,
  project: SessionProjector,
): Promise<ContextTailRead> {
  if (unpaged.get(port)?.has(device) === true) return { kind: "unsupported" }
  const sessions = kept.get(port) ?? new Map<string, Kept>()
  kept.set(port, sessions)
  const key = `${device}\0${sessionId}`
  const page = async (rpc: JsonObject): Promise<Page | Refusal> => {
    const outcome = await port.sessionCommand(device, sessionId, {
      type: "get_entries",
      sessionId,
      maxBytes: PAGE_BYTES,
      ...rpc,
    })
    return outcome.kind === "ok" ? pageOf(replyData(outcome.response)) : outcome
  }
  const failed = (outcome: Refusal): ContextTailRead => {
    sessions.delete(key)
    if (outcome.kind === "refused" && DEVICE_UNPAGED.has(outcome.reason)) {
      unpaged.set(port, (unpaged.get(port) ?? new Set()).add(device))
      return { kind: "unsupported" }
    }
    if (outcome.kind === "refused" && READ_UNPAGED.has(outcome.reason)) return { kind: "unsupported" }
    return { kind: "failed", outcome }
  }

  let entries: JsonObject[] | undefined
  let complete = false
  let leaf: string | null = null
  const previous = sessions.get(key)
  const newest = idOf(previous?.entries.at(-1))
  if (previous !== undefined && newest !== undefined) {
    entries = [...previous.entries]
    complete = previous.complete
    for (let since = newest, more = true; more;) {
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
  for (;;) {
    let status: ReturnType<typeof contextTail>
    try {
      status = contextTail(entries, leaf, complete, project)
    } catch {
      // Entries this side's projector cannot read: the holder's own get_messages answers instead.
      sessions.delete(key)
      return { kind: "unsupported" }
    }
    if (status.kind === "unanswerable") {
      sessions.delete(key)
      return { kind: "unsupported" }
    }
    if (status.kind === "closed") {
      keep(sessions, key, entries.slice(status.keepFrom), complete && status.keepFrom === 0)
      return { kind: "ok", tail: status.tail }
    }
    const before = idOf(entries[0])
    if (before === undefined) {
      complete = true
      continue
    }
    const older = await page({ before, tail: PAGE_ENTRIES })
    if ("kind" in older) return failed(older)
    entries = [...older.entries, ...entries]
    complete = !older.more || older.entries.length === 0
  }
}
