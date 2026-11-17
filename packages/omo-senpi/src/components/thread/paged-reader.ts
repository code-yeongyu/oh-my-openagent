/**
 * thread_read over the context tail of a session another device holds (#14047): the holder sends pages of its session
 * entries (`get_entries`), never the whole transcript, and this side projects them with the engine's own projector
 * (`remote/transcript-tail.ts`), so the messages are the ones `get_messages` answers: the current leaf's path, with its
 * compaction and branch summaries. The window rules are the live reader's (`reader.ts`): a first read starts at the
 * 60th message from the end and takes messages forward until the byte budget is spent; a cursor continues forward after
 * the last message it returned.
 *
 * A cursor names that message by its projected entry and binds the revision it was issued at: the session's leaf, which
 * every append, compaction and branch move changes. A changed revision is `cursor_stale`, as on every other source.
 */

import { THREAD_READ_DEFAULT_BYTES } from "./contracts"
import { threadToolFailure, type ThreadToolFailure } from "./errors"
import { takeWithinBudget } from "./read-budget"
import { THREAD_TAIL_DEFAULT_ITEMS, type ThreadTranscriptEntry } from "./reader"

/** The newest context messages of a session (at least the window's 60 unless it has fewer), oldest first. */
export type ContextTail = {
  /** `id` names the message: its projected entry and its position among that entry's messages. */
  readonly messages: readonly { readonly id: string; readonly message: ThreadTranscriptEntry }[]
  readonly revision: string
}

export type EntryPageRead =
  | {
      readonly kind: "ok"
      readonly messages: readonly ThreadTranscriptEntry[]
      readonly truncated: boolean
      readonly next_cursor: string | null
    }
  | { readonly kind: "error"; readonly error: ThreadToolFailure }

/** How many newest messages a tail must hold (unless the session has fewer) to answer every read. */
export const CONTEXT_TAIL_MESSAGES = THREAD_TAIL_DEFAULT_ITEMS

const CURSOR_VERSION = "t2"

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

/** One bounded slice of the tail; `cursor` must be undefined or an entry cursor (`isEntryCursor`). */
export function selectEntryPage(
  tail: ContextTail,
  read: { readonly max_bytes?: number; readonly cursor?: string },
): EntryPageRead {
  const { messages, revision } = tail
  let start = Math.max(0, messages.length - CONTEXT_TAIL_MESSAGES)
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
