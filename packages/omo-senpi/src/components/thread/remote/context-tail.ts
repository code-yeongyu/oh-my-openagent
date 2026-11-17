import { CONTEXT_TAIL_MESSAGES, type ContextTail } from "../paged-reader"
import type { ThreadTranscriptEntry } from "../reader"
import type { JsonObject, SessionProjector } from "./ports"

/**
 * Whether the newest entries fetched so far (a contiguous run of the session file up to its newest entry) determine the
 * tail of the session's context, and that tail when they do.
 *
 * The engine projects the leaf's path (senpi `projectSession`): with a compaction on it, the latest compaction's summary,
 * then the entries from its `firstKeptEntryId`, then everything after it; with none, every entry of the path. So a path
 * cut off at its oldest fetched entry projects the same tail as the whole path when:
 * - the walk reached the session's root; or
 * - the entries after the latest fetched compaction (or every fetched entry, with none) project at least the window's
 *   messages: they are the context's last ones, since a compaction's summary and its kept entries precede them, and an
 *   edit is always newer than the entry it edits; or
 * - the latest compaction on the path and its first kept entry were fetched (nothing older is projected).
 */
export type TailStatus =
  | { readonly kind: "closed"; readonly tail: ContextTail; readonly keepFrom: number }
  | { readonly kind: "need_older" }
  | { readonly kind: "unanswerable" }

const idOf = (entry: JsonObject | undefined): string | undefined =>
  typeof entry?.["id"] === "string" ? entry["id"] : undefined

export function contextTail(
  entries: readonly JsonObject[],
  leaf: string | null,
  complete: boolean,
  project: SessionProjector,
): TailStatus {
  if (leaf === null) return { kind: "closed", tail: { messages: [], revision: "" }, keepFrom: entries.length }
  const byId = new Map(entries.flatMap((entry) => (idOf(entry) === undefined ? [] : [[idOf(entry), entry] as const])))
  if (!byId.has(leaf)) return complete ? { kind: "unanswerable" } : { kind: "need_older" }
  const onPath = new Set<string>()
  // The path's entries newer than its latest compaction (all of them while none is found).
  const afterCompaction = new Set<string>()
  let compaction: JsonObject | undefined
  let reachedRoot = false
  for (let current = byId.get(leaf); current !== undefined;) {
    const id = idOf(current)
    if (id === undefined || onPath.has(id)) break
    onPath.add(id)
    if (compaction === undefined && current["type"] === "compaction") compaction = current
    if (compaction === undefined) afterCompaction.add(id)
    const parent = current["parentId"]
    if (typeof parent !== "string" || parent === "") {
      reachedRoot = true
      break
    }
    current = byId.get(parent)
  }
  const firstKept = typeof compaction?.["firstKeptEntryId"] === "string" ? compaction["firstKeptEntryId"] : undefined
  const projected = project(entries, leaf)
  const messages = projected.flatMap((entry) =>
    entry.messages.map((message, index) => ({
      id: `${entry.sourceEntry.id}:${index}`,
      message: message as ThreadTranscriptEntry,
    })),
  )
  const recent = projected
    .filter((entry) => afterCompaction.has(entry.sourceEntry.id))
    .reduce((count, entry) => count + entry.messages.length, 0)
  const tailIsRecent = recent >= CONTEXT_TAIL_MESSAGES
  const closed = reachedRoot || complete || tailIsRecent || (firstKept !== undefined && onPath.has(firstKept))
  if (!closed) return { kind: "need_older" }
  return {
    kind: "closed",
    tail: { messages, revision: leaf },
    keepFrom: keepFrom(entries, projected, tailIsRecent ? undefined : firstKept),
  }
}

/**
 * The oldest fetched entry a later read of the same leaf still needs: the projected entries behind the window's newest
 * messages, and the latest compaction's first kept entry. A session with no more messages than the window keeps all.
 */
function keepFrom(
  entries: readonly JsonObject[],
  projected: ReturnType<SessionProjector>,
  firstKept: string | undefined,
): number {
  const needed = new Set<string>(firstKept === undefined ? [] : [firstKept])
  let counted = 0
  for (let index = projected.length - 1; index >= 0 && counted < CONTEXT_TAIL_MESSAGES; index -= 1) {
    const entry = projected[index]
    if (entry === undefined) continue
    needed.add(entry.sourceEntry.id)
    counted += entry.messages.length
  }
  if (counted < CONTEXT_TAIL_MESSAGES) return 0
  const oldest = entries.findIndex((entry) => needed.has(idOf(entry) ?? ""))
  return oldest === -1 ? 0 : oldest
}
