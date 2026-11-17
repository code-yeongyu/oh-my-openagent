/**
 * thread_read over the newest entries of a session another device holds (#14047): the holder sends a page of its
 * session entries (`get_entries`), never the whole transcript. The transcript is the message entries among them, and
 * the window rules are the live reader's (`reader.ts`): a first read starts at the 60th message from the end and takes
 * messages forward until the byte budget is spent; a cursor continues forward after the last message it returned.
 *
 * A cursor names that message's entry by id and binds the transcript revision it was issued at: the session's leaf
 * and its newest entry, which every append or branch move changes. A changed revision is `cursor_stale`, as on every
 * other source. Every message a cursor can name lies in the newest window of its revision, so the window answers it.
 */

import { THREAD_READ_DEFAULT_BYTES } from "./contracts"
import { threadToolFailure, type ThreadToolFailure } from "./errors"
import { takeWithinBudget } from "./read-budget"
import { THREAD_TAIL_DEFAULT_ITEMS, type ThreadTranscriptEntry } from "./reader"

/** The newest entries of a session, oldest first; `complete` when nothing older exists. */
export type EntryWindow = {
  readonly entries: readonly ThreadTranscriptEntry[]
  readonly complete: boolean
  readonly leaf: string | null
}

export type EntryPageRead =
  | {
      readonly kind: "ok"
      readonly messages: readonly ThreadTranscriptEntry[]
      readonly truncated: boolean
      readonly next_cursor: string | null
    }
  | { readonly kind: "error"; readonly error: ThreadToolFailure }

/** How many newest messages a window must hold (unless the session has fewer) to answer every read. */
export const ENTRY_WINDOW_MESSAGES = THREAD_TAIL_DEFAULT_ITEMS

const CURSOR_VERSION = "t2"

export const entryIdOf = (entry: ThreadTranscriptEntry | undefined): string | undefined =>
  typeof entry?.["id"] === "string" ? entry["id"] : undefined

/** A session entry that carries one transcript message (`get_messages` lists the same message objects). */
export function messageOf(entry: ThreadTranscriptEntry): ThreadTranscriptEntry | undefined {
  const message = entry["message"]
  return entry["type"] === "message" && typeof message === "object" && message !== null && !Array.isArray(message)
    ? message
    : undefined
}

function revisionOf(window: EntryWindow): string {
  return `${window.leaf ?? ""}.${entryIdOf(window.entries.at(-1)) ?? ""}`
}

function encodeCursor(revision: string, after: string): string {
  return Buffer.from(`${CURSOR_VERSION}\n${revision}\n${after}`, "utf8").toString("base64url")
}

function decodeCursor(raw: string): { readonly revision: string; readonly after: string } | null {
  const parts = Buffer.from(raw, "base64url").toString("utf8").split("\n")
  if (parts.length !== 3 || parts[0] !== CURSOR_VERSION) return null
  const [, revision = "", after = ""] = parts
  return after === "" ? null : { revision, after }
}

/** Whether a cursor came from this reader (the other sources' cursors are answered by their own reader). */
export function isEntryCursor(raw: string): boolean {
  return decodeCursor(raw) !== null
}

/** A cursor whose position the transcript no longer has, or that a holder which pages nothing cannot answer. */
export const staleEntryCursor = (): Extract<EntryPageRead, { readonly kind: "error" }> => ({
  kind: "error",
  error: threadToolFailure(
    "cursor_stale",
    "The transcript changed after this cursor was issued, so its position no longer names the same entries.",
    "Re-read the thread without a cursor to restart from a current revision.",
  ),
})

/** One bounded slice of the window; `cursor` must be undefined or an entry cursor (`isEntryCursor`). */
export function selectEntryPage(
  window: EntryWindow,
  read: { readonly max_bytes?: number; readonly cursor?: string },
): EntryPageRead {
  const revision = revisionOf(window)
  const messages = window.entries.flatMap((entry) => {
    const message = messageOf(entry)
    return message === undefined ? [] : [{ id: entryIdOf(entry), message }]
  })
  let start = Math.max(0, messages.length - ENTRY_WINDOW_MESSAGES)
  if (read.cursor !== undefined) {
    const cursor = decodeCursor(read.cursor)
    if (cursor === null || cursor.revision !== revision) return staleEntryCursor()
    const index = messages.findIndex((entry) => entry.id === cursor.after)
    if (index === -1) return staleEntryCursor()
    start = index + 1
  }
  const { selected } = takeWithinBudget(
    messages.slice(start).map((entry) => entry.message),
    read.max_bytes ?? THREAD_READ_DEFAULT_BYTES,
  )
  const end = start + selected.length
  const truncated = end < messages.length
  return {
    kind: "ok",
    messages: selected,
    truncated,
    next_cursor: truncated ? encodeCursor(revision, messages[end - 1]?.id ?? "") : null,
  }
}
