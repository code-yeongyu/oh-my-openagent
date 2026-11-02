// Item document lifecycle (sync-design §2, §4). A tombstone vector must cover its own
// append op, or the append itself would keep the item alive; the append is one op on the
// deleter's peer, so the stored vector is the oplog vector with that peer's end + 1.
// Liveness (§4): at least one operation not covered by the pointwise-max tombstone vector.

import { loadLoroRuntime, type LoroDoc, type PeerID } from "../../crdt/loro-runtime"
import { TOMBSTONES_NAME, cidRoot } from "./state"

export type ItemFrontier = { peer: PeerID; counter: number }[]

export async function createItemDoc(peer: PeerID): Promise<LoroDoc> {
  const { LoroDoc } = await loadLoroRuntime()
  const doc = new LoroDoc()
  doc.setPeerId(peer)
  doc.setRecordTimestamp(false)
  return doc
}

export function itemFrontier(doc: LoroDoc): ItemFrontier {
  return doc.frontiers()
}

export function deleteItem(doc: LoroDoc): void {
  doc.commit()
  const ends = doc.oplogVersion().toJSON()
  const own = doc.peerIdStr
  const entries: [string, number][] = []
  for (const [peer, end] of ends) entries.push([peer, end])
  const predicted = (ends.get(own) ?? 0) + 1
  const index = entries.findIndex(([peer]) => peer === own)
  if (index < 0) entries.push([own, predicted])
  else entries[index] = [own, predicted]
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  doc.getList(TOMBSTONES_NAME).push(entries)
  doc.commit()
}

export function isLive(doc: LoroDoc): boolean {
  const coverage = new Map<string, number>()
  if (doc.hasContainer(cidRoot(TOMBSTONES_NAME, "List"))) {
    for (const entry of doc.getList(TOMBSTONES_NAME).toArray()) {
      for (const [peer, end] of asPairList(entry)) {
        coverage.set(peer, Math.max(coverage.get(peer) ?? 0, end))
      }
    }
  }
  for (const [peer, end] of doc.oplogVersion().toJSON()) {
    if (end > (coverage.get(peer) ?? 0)) return true
  }
  return false
}

function asPairList(entry: unknown): readonly (readonly [string, number])[] {
  if (!Array.isArray(entry)) return []
  const out: [string, number][] = []
  for (const pair of entry) {
    if (!Array.isArray(pair) || pair.length !== 2) continue
    const [peer, end] = pair
    if (typeof peer !== "string" || typeof end !== "number") continue
    out.push([peer, end])
  }
  return out
}
