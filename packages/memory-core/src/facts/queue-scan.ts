// Reads facts queue entries from one directory (the hot queue dir or parked/). A conversation filter
// matches the hash the file name carries, so unrelated payloads are never opened.
import { readFile, readdir } from "../fs/resilient"
import { join } from "node:path"

import { parseQueueEntry, queueConversationHash, type FactsQueueEntry } from "./schema"

const LEDGER_FILES = new Set(["consumed.json", "failures.json", "claims.json"])

export type ScannedQueueEntry = FactsQueueEntry & { readonly filePath: string }

export async function scanQueueEntries(dir: string, conversationId?: string): Promise<ScannedQueueEntry[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error) {
    // Only an absent directory means "no entries"; any other error must surface, or a caller that needs every
    // retained endpoint (the enqueue anchor) would silently move backward.
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return []
    throw error
  }
  const conversationPart = conversationId === undefined ? undefined : `-${queueConversationHash(conversationId)}-`
  const entries: ScannedQueueEntry[] = []
  for (const name of names.sort()) {
    if (!name.endsWith(".json") || LEDGER_FILES.has(name)) continue
    if (conversationPart !== undefined && !name.includes(conversationPart)) continue
    const filePath = join(dir, name)
    const raw = await readFile(filePath, "utf8").catch(() => undefined)
    if (raw === undefined) continue
    const parsed = parseQueueEntry(raw)
    if (parsed === undefined) continue
    entries.push({ ...parsed, filePath })
  }
  return entries
}
