import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { JsonObject, SessionProjector } from "./remote/ports"
import type { ThreadTranscriptEntry } from "./reader"

// senpi's own session projection (what its engine's get_messages answers), loaded from the pinned dist like
// senpi-test-runtime.ts loads its modules.
const sessionManager = (await import(
  pathToFileURL(join(dirname(fileURLToPath(import.meta.resolve("@code-yeongyu/senpi"))), "core", "session-manager.js"))
    .href
)) as Pick<typeof import("@code-yeongyu/senpi"), "buildSessionContext" | "buildSessionProjection">

export const senpiProjector: SessionProjector = (entries, leafId) =>
  sessionManager.buildSessionProjection(entries as never, leafId).entries

/** `session.messages` of a session holding these entries at this leaf: what get_messages answers. */
export const senpiContext = (
  entries: readonly ThreadTranscriptEntry[],
  leafId: string | null,
): ThreadTranscriptEntry[] =>
  sessionManager.buildSessionContext(entries as never, leafId).messages as unknown as ThreadTranscriptEntry[]

/**
 * A session's entries as senpi's `get_entries` answers them (senpi `get-entries-command.ts` / `get-entries-page.ts`):
 * `since`/`before` bound the range in file order (every branch), `tail` pages backward from its end, `limit` forward,
 * `maxBytes` caps a page (the first entry of a page always ships), `leafId` is the session's current leaf (`leaf`,
 * else the newest entry). `pages` counts the answers; `refuse` makes every page answer that code.
 */
export type FakeEntryLog = {
  readonly entries: ThreadTranscriptEntry[]
  pages: number
  leaf?: string | null
  refuse?: string
}

const size = (entry: ThreadTranscriptEntry) => Buffer.byteLength(JSON.stringify(entry)) + 1

export function answerGetEntries(
  log: FakeEntryLog,
  rpc: JsonObject,
): { readonly data: JsonObject } | { readonly refused: string } {
  log.pages += 1
  if (log.refuse !== undefined) return { refused: log.refuse }
  let range = [...log.entries]
  if (rpc["before"] !== undefined) {
    const at = range.findIndex((entry) => entry["id"] === rpc["before"])
    if (at === -1) return { refused: "not_found" }
    range = range.slice(0, at)
  }
  if (rpc["since"] !== undefined) {
    const at = log.entries.findIndex((entry) => entry["id"] === rpc["since"])
    if (at === -1) return { refused: "not_found" }
    range = log.entries.slice(at + 1).filter((entry) => range.includes(entry))
  }
  const maxBytes = typeof rpc["maxBytes"] === "number" ? rpc["maxBytes"] : Number.POSITIVE_INFINITY
  const tail = typeof rpc["tail"] === "number" ? rpc["tail"] : undefined
  const limit = typeof rpc["limit"] === "number" ? rpc["limit"] : undefined
  const page: ThreadTranscriptEntry[] = []
  let bytes = 0
  for (const entry of tail === undefined ? range : [...range].reverse()) {
    if ((tail ?? limit) !== undefined && page.length >= (tail ?? limit ?? 0)) break
    if (page.length > 0 && bytes + size(entry) > maxBytes) break
    page.push(entry)
    bytes += size(entry)
  }
  if (tail !== undefined) page.reverse()
  const hasMore = page.length < range.length
  const newest = log.entries.at(-1)?.["id"]
  const leaf = log.leaf !== undefined ? log.leaf : typeof newest === "string" ? newest : null
  return {
    data: {
      entries: page,
      leafId: leaf,
      hasMore,
      ...(hasMore && tail !== undefined && typeof page[0]?.["id"] === "string" ? { next_before: page[0]["id"] } : {}),
    },
  }
}

/** A linear session: each message a child of the one before, with a model change every `every` messages. */
export function sessionEntries(messages: readonly ThreadTranscriptEntry[], every = 7): ThreadTranscriptEntry[] {
  const entries: ThreadTranscriptEntry[] = []
  let parent: string | null = null
  messages.forEach((message, index) => {
    if (index % every === 0) {
      entries.push({
        type: "model_change",
        id: `mc${index}`,
        parentId: parent,
        timestamp: stamp(index),
        provider: "anthropic",
        modelId: "claude-opus",
      })
      parent = `mc${index}`
    }
    entries.push({ type: "message", id: `e${index}`, parentId: parent, timestamp: stamp(index), message })
    parent = `e${index}`
  })
  return entries
}

export const stamp = (index: number): string => new Date(Date.UTC(2026, 10, 17) + index * 1000).toISOString()
