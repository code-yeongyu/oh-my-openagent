// The receive half, outside the writer lock (sync-design §5-§6): pull after the applied cursor in
// pages, download each object, check its SHA-256 against the entry, verify it, and journal it as
// `verified`. An entry this device already holds is a no-op when its (seq, batch id, digest)
// match and tampering when anything differs. The first refusal stops the pull: nothing after it
// is verified, so entries are applied strictly in order.

import { createHash } from "node:crypto"

import type { EngineDeps } from "./engine-deps"
import { toBase64, type IncomingRecord, type SyncJournal } from "./journal"
import type { PulledEntry, RefusalCode, SnapshotRef, Verdict } from "./ports"

const PAGE = 100

export interface Received {
  readonly refused: number
  readonly snapshot: number | null
}

const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex")

async function takeSnapshot(deps: EngineDeps, journal: SyncJournal, entry: PulledEntry, s: SnapshotRef): Promise<RefusalCode | null> {
  const chunks: Uint8Array[] = []
  for (const id of s.objectIds) chunks.push(await deps.transport.download(id))
  const only = chunks.length === 1 ? chunks[0] : undefined
  if (s.digest !== null && only !== undefined && sha256Hex(only) !== s.digest) return "content_hash"
  await journal.putIncoming({ entry, stage: "downloaded", items: [], snapshot: true })
  deps.fault?.("downloaded")
  const verdict = await deps.verifier.verifySnapshot(s, chunks)
  if (!verdict.ok) return verdict.code
  const items = verdict.payload.items.map((i) => ({ key: i.key, ops: toBase64(i.ops) }))
  await journal.putIncoming({ entry, stage: "verified", items, snapshot: true })
  deps.fault?.("verified")
  return null
}

export async function receive(deps: EngineDeps, journal: SyncJournal): Promise<Received> {
  const state = await journal.state()
  const index = await journal.applied()
  const held = new Map((await journal.incoming()).map((r) => [r.entry.seq, r]))
  const heldBatches = new Map([...held.values()].map((r) => [r.entry.batchId, r.entry]))
  let expected = state.applied + 1
  let after = state.applied
  let snapshot: number | null = null
  const refusal = async (entry: PulledEntry, code: RefusalCode): Promise<Received> => {
    deps.log?.(`sync.batch.rejected seq=${entry.seq} batch=${entry.batchId}: ${code}`)
    await journal.updateState({ refused: (await journal.state()).refused + 1, paused: { seq: entry.seq, code } })
    return { refused: 1, snapshot }
  }
  const take = async (entry: PulledEntry, verify: (bytes: Uint8Array) => Promise<Verdict>): Promise<RefusalCode | null> => {
    const bytes = entry.kind === "keyring" ? new Uint8Array() : await deps.transport.download(entry.objectId)
    if (entry.kind === "batch" && sha256Hex(bytes) !== entry.digest) return "content_hash"
    await journal.putIncoming({ entry, stage: "downloaded", items: [], snapshot: false })
    deps.fault?.("downloaded")
    const verdict = await verify(bytes)
    if (!verdict.ok) return verdict.code
    // The pull row names the batch; an object whose sealed header names another is not this entry.
    if (entry.batchId !== null && verdict.batchId !== entry.batchId) return "object_binding"
    const elsewhere = index[verdict.batchId] ?? heldBatches.get(verdict.batchId)
    if (elsewhere !== undefined && elsewhere.seq !== entry.seq) return "replayed_content"
    const items = verdict.payload.items.map((i) => ({ key: i.key, ops: toBase64(i.ops) }))
    const named = { ...entry, batchId: verdict.batchId }
    await journal.putIncoming({ entry: named, stage: "verified", items, snapshot: false } satisfies IncomingRecord)
    deps.fault?.("verified")
    return null
  }
  for (;;) {
    const page = await deps.transport.pull(after, PAGE)
    if (page.snapshot !== null && page.snapshot.coversSeq >= expected) {
      const s = page.snapshot
      const entry: PulledEntry = { seq: s.coversSeq, kind: "batch", batchId: `snapshot:${s.coversSeq}`, digest: s.digest ?? "", objectId: s.objectIds.join(","), author: "snapshot" }
      if (held.get(s.coversSeq)?.stage !== "verified") {
        const problem = await takeSnapshot(deps, journal, entry, s)
        if (problem !== null) return refusal(entry, problem)
      }
      snapshot = s.coversSeq
      expected = s.coversSeq + 1
    }
    for (const entry of page.entries) {
      const known = entry.batchId === null ? undefined : (index[entry.batchId] ?? heldBatches.get(entry.batchId))
      if (entry.seq < expected) {
        const original = known ?? held.get(entry.seq)?.entry
        if (original !== undefined && (original.seq !== entry.seq || original.digest !== entry.digest)) {
          return refusal(entry, "replayed_content")
        }
        continue
      }
      if (entry.seq !== expected) return refusal(entry, "sequence_gap")
      if (known !== undefined && known.seq !== entry.seq) return refusal(entry, "replayed_content")
      const mine = held.get(entry.seq)
      if (mine?.stage !== "verified" || mine.entry.digest !== entry.digest) {
        const problem = await take(entry, (bytes) => deps.verifier.verifyEntry(entry, bytes))
        if (problem !== null) return refusal(entry, problem)
      }
      expected = entry.seq + 1
    }
    const last = page.entries.at(-1)
    if (!page.more || last === undefined) {
      if (state.paused !== null) await journal.updateState({ paused: null })
      return { refused: 0, snapshot }
    }
    after = last.seq
  }
}
