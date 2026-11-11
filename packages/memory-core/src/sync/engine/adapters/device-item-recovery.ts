// The device item store's recovery operations (#12284), over the store's private state: reviving a
// re-created item, winding this device's unpublished ops back out of an item (an older build queued
// them at a size no batch carries), and finishing the import a crash between journaling and importing
// a capture left owed. device-item-store.ts keeps load, capture, apply, render and persist.

import { loadLoroRuntime, type LoroDoc } from "../../../crdt/loro-runtime"
import {
  captureOnDevice,
  type ItemDevice,
  type ItemFrontier,
  isLive,
  itemFrontier,
  readReceipts,
  receiptLanded,
  recordMaterialized,
  renderDocContent,
  writeReceipts,
} from "../../item"

export interface Baseline {
  readonly text: string | null
  readonly frontier: ItemFrontier
}

/** The store state the recovery operations read and write. */
export interface ItemStoreState {
  readonly docs: Map<string, LoroDoc>
  readonly baselines: Map<string, Baseline>
  readonly dirty: Set<string>
  readonly device: () => ItemDevice
  readonly docOf: (key: string) => Promise<LoroDoc>
  readonly log?: (line: string) => void
}

const keyLength = (key: string): number => Buffer.byteLength(key, "utf8")

export function createItemRecovery(state: ItemStoreState) {
  const { docs, baselines, dirty, device, docOf } = state

  /** recordMaterialized: `text` is what the item's file holds at the doc's current frontier. */
  const materialize = async (key: string, text: string | null): Promise<void> => {
    const doc = await docOf(key)
    if (text !== null) await recordMaterialized(device(), key, doc, itemFrontier(doc), text)
    baselines.set(key, { text, frontier: itemFrontier(doc) })
    dirty.add(key)
  }

  /** The doc back at `frontiers`, re-pinned to the device peer; the replaced doc is freed. */
  const resetTo = (key: string, doc: LoroDoc, frontiers: ItemFrontier): LoroDoc => {
    const fork = doc.forkAt([...frontiers])
    fork.setPeerId(device().peer)
    fork.setRecordTimestamp(false)
    docs.set(key, fork)
    doc.free()
    return fork
  }

  /**
   * A person re-created a deleted item. The dead doc still holds its last content at its current
   * frontier, so capture runs against exactly that (any new op past the tombstone makes the item
   * live again). Re-created model-unchanged, the diff is empty, so one explicit no-change op revives it.
   */
  const revive = async (key: string, doc: LoroDoc, workingText: string): Promise<Uint8Array | null> => {
    const ops = await captureOnDevice(device(), key, doc, renderDocContent(doc), itemFrontier(doc), workingText)
    if (ops !== null) return ops
    const target = doc.fork()
    try {
      target.setPeerId(doc.peerId)
      target.setRecordTimestamp(false)
      const body = target.getText("body")
      body.insert(0, "\u0000")
      body.delete(0, 1)
      target.commit()
      return target.export({ mode: "update", from: doc.oplogVersion() })
    } finally {
      target.free()
    }
  }

  async function rewind(key: string, ops: readonly Uint8Array[]): Promise<"rewound" | "kept"> {
    const doc = docs.get(key)
    const peer = device().peer
    const { decodeImportBlobMeta } = await loadLoroRuntime()
    let start = Number.POSITIVE_INFINITY
    for (const blob of ops) {
      let counter: number | undefined
      try {
        counter = decodeImportBlobMeta(blob, false).partialStartVersionVector.get(peer)
      } catch {
        return "kept"
      }
      if (counter === undefined) return "kept"
      start = Math.min(start, counter)
    }
    if (doc !== undefined) {
      const version = doc.oplogVersion()
      // Clamped: ops the doc never imported (a crash between journaling and importing) cut nothing.
      if (start < (version.get(peer) ?? 0)) {
        version.setEnd({ peer, counter: start })
        resetTo(key, doc, doc.vvToFrontiers(version))
      }
    }
    const now = docs.get(key)
    if (now === undefined || now.oplogVersion().toJSON().size === 0) {
      // Nothing of the item is left: it captures as a brand-new file.
      now?.free()
      docs.delete(key)
      baselines.delete(key)
    } else {
      baselines.set(key, { text: isLive(now) ? renderDocContent(now) : null, frontier: itemFrontier(now) })
      dirty.add(key)
    }
    // Receipts name captures of the wound-back ops; the counters they used are free again.
    await writeReceipts(device().stateDir, key, [])
    return "rewound"
  }

  async function adoptJournaled(key: string, ops: Uint8Array): Promise<"held" | "imported" | "refused"> {
    const peer = device().peer
    const { decodeImportBlobMeta } = await loadLoroRuntime()
    let meta: ReturnType<typeof decodeImportBlobMeta>
    try {
      meta = decodeImportBlobMeta(ops, false)
    } catch {
      return "refused"
    }
    // Every op in the blob must be this device's: a foreign one is never its to import or send.
    const starts = meta.partialStartVersionVector.toJSON()
    const start = starts.get(peer)
    if (start === undefined || starts.size !== 1) return "refused"
    const doc = await docOf(key)
    const version = doc.oplogVersion()
    if ([...meta.partialEndVersionVector.toJSON()].every(([p, end]) => (version.get(p) ?? 0) >= end)) return "held"
    // Missing deps would queue the ops inside the doc and on every receiver.
    if (!meta.startFrontiers.every(({ peer: p, counter }) => (version.get(p) ?? 0) > counter)) return "refused"
    const before = itemFrontier(doc)
    // A model-unchanged revive writes no receipt (`revive` above), so the dead doc's content is what it recorded.
    const revivedText = !isLive(doc) && version.toJSON().size > 0 ? renderDocContent(doc) : undefined
    let refused = false
    try {
      refused = doc.import(ops).pending !== null
    } catch {
      refused = true
    }
    if (refused) {
      resetTo(key, doc, before)
      return "refused"
    }
    dirty.add(key)
    if (!isLive(doc)) {
      await materialize(key, null)
      return "imported"
    }
    // The receipt of the capture that produced these ops, found by its span (a revive's sits at the dead
    // doc's frontier, not the baseline's); receiptLanded checks its capture id on the change at that start.
    const receipts = await readReceipts(device().stateDir, key)
    const receipt = receipts.find(
      (r) => r.span !== null && r.span.peer === peer && r.span.start === start && receiptLanded(doc, r),
    )
    if (receipt !== undefined) await materialize(key, receipt.text)
    else if (revivedText !== undefined) await materialize(key, revivedText)
    else state.log?.(`sync.item.adopted-unreceipted len=${keyLength(key)}`)
    return "imported"
  }

  return { materialize, revive, rewind, adoptJournaled }
}
