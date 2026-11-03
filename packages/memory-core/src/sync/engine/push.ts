// The push half, outside the writer lock (sync-design §6): seal the journaled pending ops as one
// batch on the applied cursor, reserve, upload, append. Each step is journaled before the next, and
// the batch id is the append's idempotency key, so a crash after the server accepted the batch
// re-sends the same id and gets the original seq back instead of a second entry.

import { createHash, randomBytes } from "node:crypto"

import { MAX_BATCH_BYTES, splitBatches } from "./batches"
import type { EngineDeps } from "./engine-deps"
import { fromBase64, type OutgoingBatch, type SyncJournal, toBase64, type WireItem } from "./journal"

export type PushOutcome = "idle" | "pushed" | "stale"

const BACKOFF_BASE_MS = 250
const BACKOFF_CAP_MS = 8_000

/** Full-window jitter in the upper half: [window/2, window), the window doubling to the cap. */
export function staleBackoffMs(attempt: number, random: () => number = Math.random): number {
  const window = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS)
  return Math.floor(window / 2 + random() * (window / 2))
}

const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex")
const carried = (out: OutgoingBatch, item: WireItem): boolean => out.items.some((o) => o.key === item.key && o.ops === item.ops)

async function seal(deps: EngineDeps, journal: SyncJournal, items: readonly WireItem[], batchId: string): Promise<OutgoingBatch> {
  const all = (await journal.pending()).items
  const baseSeq = (await journal.state()).applied
  const payload = { items: items.map((i) => ({ key: i.key, ops: fromBase64(i.ops) })) }
  const sealed = await deps.sealer.seal(batchId, baseSeq, payload)
  const out: OutgoingBatch = {
    batchId,
    baseSeq,
    digest: sha256Hex(sealed.bytes),
    bytes: toBase64(sealed.bytes),
    uploadId: null,
    epoch: sealed.epoch,
    link: sealed.link,
    recordSig: sealed.recordSig,
    stage: "sealed",
    items,
  }
  await journal.setPending({ items: all, outgoing: out })
  deps.fault?.("sealed")
  return out
}

export async function push(deps: EngineDeps, journal: SyncJournal, batchBytes = MAX_BATCH_BYTES): Promise<PushOutcome> {
  let outcome: PushOutcome = "idle"
  for (;;) {
    const step = await pushOne(deps, journal, batchBytes)
    if (step === "idle") return outcome
    if (step === "stale") return "stale"
    outcome = "pushed"
  }
}

async function pushOne(deps: EngineDeps, journal: SyncJournal, batchBytes: number): Promise<PushOutcome> {
  const pending = await journal.pending()
  let out = pending.outgoing
  if (out === null) {
    const first = splitBatches(pending.items, batchBytes)[0]
    if (first === undefined) return "idle"
    out = await seal(deps, journal, first, randomBytes(16).toString("base64url"))
  }
  const bytes = fromBase64(out.bytes)
  if (out.stage === "sealed") {
    out = { ...out, uploadId: await deps.transport.reserve(bytes.length, out.digest), stage: "reserved" }
    await journal.setPending({ ...pending, outgoing: out })
    deps.fault?.("reserved")
  }
  if (out.stage === "reserved") {
    await deps.transport.upload(out.uploadId ?? "", bytes)
    out = { ...out, stage: "uploaded" }
    await journal.setPending({ ...pending, outgoing: out })
    deps.fault?.("uploaded")
  }
  const result = await deps.transport.append({
    uploadId: out.uploadId ?? "",
    digest: out.digest,
    baseSeq: out.baseSeq,
    batchId: out.batchId,
    epoch: out.epoch,
    link: out.link,
    recordSig: out.recordSig,
  })
  if (!result.ok) {
    await journal.setPending({ items: (await journal.pending()).items, outgoing: null })
    return "stale"
  }
  deps.fault?.("append-landed")
  const sent = out
  await journal.recordApplied([{ seq: result.seq, kind: "batch", batchId: sent.batchId, digest: sent.digest, objectId: "", author: "self" }])
  const state = await journal.state()
  if (result.seq === state.applied + 1) await journal.updateState({ applied: result.seq })
  const remaining = (await journal.pending()).items.filter((i) => !carried(sent, i))
  await journal.setPending({ items: remaining, outgoing: null })
  deps.fault?.("appended")
  return "pushed"
}
