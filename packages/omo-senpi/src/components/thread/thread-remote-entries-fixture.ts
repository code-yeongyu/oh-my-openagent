import type { JsonObject } from "./remote/ports"
import type { ThreadTranscriptEntry } from "./reader"

/**
 * A session's entries as senpi's `get_entries` answers them (senpi `get-entries-command.ts` / `get-entries-page.ts`):
 * `since`/`before` bound the range, `tail` pages backward from its end, `limit` forward from its start, `maxBytes` caps
 * a page (the first entry of a page always ships), `leafId` is the newest entry. `pages` counts the answers; `refuse`
 * makes the engine answer every page with that code (an engine that stopped paging).
 */
export type FakeEntryLog = {
  readonly entries: ThreadTranscriptEntry[]
  pages: number
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
  const indexOf = (id: unknown) => range.findIndex((entry) => entry["id"] === id)
  if (rpc["before"] !== undefined) {
    const at = indexOf(rpc["before"])
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
  const ordered = tail === undefined ? range : [...range].reverse()
  for (const entry of ordered) {
    if ((tail ?? limit) !== undefined && page.length >= (tail ?? limit ?? 0)) break
    if (page.length > 0 && bytes + size(entry) > maxBytes) break
    page.push(entry)
    bytes += size(entry)
  }
  if (tail !== undefined) page.reverse()
  const hasMore = page.length < range.length
  const leaf = log.entries.at(-1)?.["id"]
  return {
    data: {
      entries: page,
      leafId: typeof leaf === "string" ? leaf : null,
      hasMore,
      ...(hasMore && tail !== undefined && typeof page[0]?.["id"] === "string" ? { next_before: page[0]["id"] } : {}),
      ...(hasMore && tail === undefined && typeof page.at(-1)?.["id"] === "string"
        ? { nextSince: page.at(-1)?.["id"] ?? null }
        : {}),
    },
  }
}

/** A session file's entries for these messages, with a model change every `every` messages (bookkeeping, not transcript). */
export function sessionEntries(messages: readonly ThreadTranscriptEntry[], every = 7): ThreadTranscriptEntry[] {
  const entries: ThreadTranscriptEntry[] = []
  messages.forEach((message, index) => {
    if (index % every === 0)
      entries.push({ type: "model_change", id: `mc${index}`, provider: "anthropic", modelId: "claude-opus" })
    entries.push({ type: "message", id: `e${index}`, timestamp: `2026-11-17T00:00:${index}Z`, message })
  })
  return entries
}
