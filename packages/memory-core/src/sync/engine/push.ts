// The push half, outside the writer lock (sync-design §6): seal the journaled pending ops as one
// batch on the applied cursor, reserve, upload, append. Each step is journaled before the next, and
// the batch id is the append's idempotency key, so a crash after the server accepted the batch
// re-sends the same id and gets the original seq back instead of a second entry.
// The journal keeps an index of pending items with their ops in segment files (outbox.ts), so
// each step reads and writes one batch's worth, never the whole backlog (#12286).

import { createHash, randomBytes } from "node:crypto"

import { MAX_BATCH_BYTES, planBatches } from "./batches"
import type { EngineDeps } from "./engine-deps"
import type { SyncJournal } from "./journal"
import type { OutgoingBatch, PendingItem, PendingOps } from "./outbox"

export type PushOutcome = "idle" | "pushed" | "stale"

const BACKOFF_BASE_MS = 250
const BACKOFF_CAP_MS = 8_000

/** Full-window jitter in the upper half: [window/2, window), the window doubling to the cap. */
export function staleBackoffMs(attempt: number, random: () => number = Math.random): number {
  const window = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS)
  return Math.floor(window / 2 + random() * (window / 2))
}

const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex")

async function seal(
  deps: EngineDeps,
  journal: SyncJournal,
  items: readonly PendingItem[],
  batchId: string,
): Promise<OutgoingBatch> {
  const baseSeq = (await journal.state()).applied
  // Only this batch's ops are read: the rest of the backlog stays on disk.
  const payload: { key: string; ops: Uint8Array }[] = []
  for (const item of items) payload.push({ key: item.key, ops: await journal.outbox.readOps(item) })
  const sealed = await deps.sealer.seal(batchId, baseSeq, { items: payload })
  // The bytes are durable before the index names the batch, so a resumed push always finds them.
  await journal.outbox.putBatch(batchId, sealed.bytes)
  const out: OutgoingBatch = {
    batchId,
    baseSeq,
    digest: sha256Hex(sealed.bytes),
    uploadId: null,
    epoch: sealed.epoch,
    link: sealed.link,
    recordSig: sealed.recordSig,
    stage: "sealed",
    items,
  }
  await journal.setPending({ items: (await journal.pending()).items, outgoing: out })
  deps.fault?.("sealed")
  return out
}

/** `withheld`: keys whose queued ops this device must not send (#12284); they stay pending. */
export async function push(
  deps: EngineDeps,
  journal: SyncJournal,
  batchBytes = MAX_BATCH_BYTES,
  withheld: ReadonlySet<string> = new Set(),
): Promise<PushOutcome> {
  let outcome: PushOutcome = "idle"
  for (;;) {
    const step = await pushOne(deps, journal, batchBytes, withheld)
    if (step === "idle") return outcome
    if (step === "stale") return "stale"
    outcome = "pushed"
  }
}

async function pushOne(
  deps: EngineDeps,
  journal: SyncJournal,
  batchBytes: number,
  withheld: ReadonlySet<string>,
): Promise<PushOutcome> {
  const pending = await journal.pending()
  let out = pending.outgoing
  if (out !== null && deps.sealer.sealedBySelf !== undefined && !(await deps.sealer.sealedBySelf(out))) {
    deps.log?.("sync: the journaled batch was sealed by a previous principal of this device; re-sealing it")
    await journal.setPending({ items: pending.items, outgoing: null })
    out = null
  }
  if (out === null) {
    const plan = planBatches(pending.items, batchBytes, withheld)
    // Only ops this device could not wind back are left here (#12284 review L4): never sent, always said.
    for (const key of new Set(plan.held.map((item) => item.key)))
      deps.log?.(`sync.item.held side=push len=${Buffer.byteLength(key, "utf8")}`)
    const first = plan.batches[0]
    if (first === undefined) {
      await journal.outbox.sweep(pending)
      return "idle"
    }
    out = await seal(deps, journal, first, randomBytes(16).toString("base64url"))
  }
  const bytes = await journal.outbox.readBatch(out)
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
    // The refused batch leaves the index, so its sealed file goes too: a freeze refuses every
    // cycle, and each would otherwise leave one more batch behind.
    const dropped: PendingOps = { items: (await journal.pending()).items, outgoing: null }
    await journal.setPending(dropped)
    await journal.outbox.sweep(dropped)
    return "stale"
  }
  deps.fault?.("append-landed")
  const sent = out
  await journal.recordApplied([
    { seq: result.seq, kind: "batch", batchId: sent.batchId, digest: sent.digest, objectId: "", author: "self" },
  ])
  const state = await journal.state()
  if (result.seq === state.applied + 1) await journal.updateState({ applied: result.seq })
  const carried = new Set(sent.items.map((i) => i.digest))
  const next: PendingOps = {
    items: (await journal.pending()).items.filter((i) => !carried.has(i.digest)),
    outgoing: null,
  }
  await journal.setPending(next)
  deps.fault?.("appended")
  await journal.outbox.sweep(next)
  return "pushed"
}
