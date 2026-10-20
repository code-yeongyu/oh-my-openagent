// The locked half of a cycle (sync-design §5): capture local edits into journaled pending ops
// before anything remote lands, apply verified batches in seq order, then drive the cycle record
// merged -> rendered -> committed -> checkpointed. `advance` is the same code path for a fresh
// cycle and for one resumed after a crash, so each stage is reached exactly once.
//
// Crash-resume protocol for the render (stage merged), with the invariants it keeps:
//  1. Render records in renders/<cycle id>/ are append-only until the cycle ends (never rewritten).
//  2. A record exists only after its staged render file is durable.
//  3. A staged file is moved into place only after the record that describes it is durable.
//  4. For the latest record of a key, its staged file is absent iff that render landed (a delete
//     is the inverse: the working file is moved to the staged path).
//  5. A key's baseline is set to a recorded render (text, frontier) only when that render landed
//     and the item doc is still at that frontier; once a capture moved past it, it stays.
//  6. Replaying advance from any durable state, any number of times, renders each key at most once
//     per (key, frontier) and leaves the same working tree, docs and pending ops.
// A person's edit made after a crash is therefore captured against exactly the text it was made
// on: the landed render (inv. 5), or the old baseline when the render never landed.

import { createHash, randomBytes } from "node:crypto"
import { existsSync, mkdir, readdir, readFile, rename } from "../../fs/resilient"
import { dirname, join, relative, sep } from "node:path"

import { syncJournalDirectory } from "../../journal/fsync"
import { removeAtomic, TEMP_MARK, writeAtomic } from "./atomic"
import type { EngineDeps } from "./engine-deps"
import { type CycleRecord, fromBase64, type RenderRecord, type SyncJournal, toBase64, type WireItem } from "./journal"
import { adoptLegacyRenders } from "./legacy-cycle"

export interface Applied {
  readonly batches: number
  /** Distinct memories the cycle rendered. */
  readonly memories: number
}

async function workingKeys(root: string): Promise<string[]> {
  const names = await readdir(root, { recursive: true, withFileTypes: true })
  return names
    .filter((d) => d.isFile())
    .map((d) => relative(root, join(d.parentPath, d.name)).split(sep).join("/"))
    .filter((k) => !k.startsWith(".git/") && k !== ".git" && !k.includes(TEMP_MARK))
}

const readWorking = (root: string, key: string): Promise<string | null> =>
  readFile(join(root, key), "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
    throw error
  })

const sameItem = (a: WireItem, b: WireItem): boolean => a.key === b.key && a.ops === b.ops

const textHash = (text: string | null): string => createHash("sha256").update(text === null ? "\u0000absent" : `t:${text}`).digest("hex")

const latestByKey = (records: readonly RenderRecord[]): Map<string, RenderRecord> => {
  const latest = new Map<string, RenderRecord>()
  for (const record of records) latest.set(record.key, record)
  return latest
}

/** Invariant 5: a landed render becomes the baseline only while the doc is still at its frontier. */
async function adoptLandedRenders(deps: EngineDeps, journal: SyncJournal, cycle: CycleRecord): Promise<void> {
  const latest = latestByKey(await journal.renders(cycle.id))
  for (const record of latest.values()) {
    if (!journal.renderLanded(cycle.id, record)) continue
    if ((await deps.store.version(record.key)) !== record.frontier) continue
    await deps.store.markMaterialized(record.key, record.text)
  }
  await adoptLegacyRenders(deps, cycle, new Set(latest.keys()), (key) => readWorking(deps.repo.root, key))
}

export async function capture(deps: EngineDeps, journal: SyncJournal, resuming: CycleRecord | null = null): Promise<number> {
  // Resuming a cycle at merged: every render that landed is the base of any edit made since.
  if (resuming !== null) await adoptLandedRenders(deps, journal, resuming)
  const keys = [...new Set([...deps.store.keys(), ...(await workingKeys(deps.repo.root))])].sort()
  const captured: WireItem[] = []
  const texts = new Map<string, string | null>()
  for (const key of keys) {
    const text = await readWorking(deps.repo.root, key)
    const ops = await deps.store.capture(key, text)
    if (ops === null) continue
    captured.push({ key, ops: toBase64(ops) })
    texts.set(key, text)
  }
  if (captured.length === 0) return 0
  const pending = await journal.pending()
  const fresh = captured.filter((c) => !pending.items.some((p) => sameItem(p, c)))
  await journal.setPending({ ...pending, items: [...pending.items, ...fresh] })
  deps.fault?.("captured")
  for (const item of captured) {
    await deps.store.apply(item.key, fromBase64(item.ops))
    // The captured text is now what the item's doc holds; without this the next capture sees the
    // same edit again and pushes it again (and a restarted device would not reload the item).
    await deps.store.markMaterialized(item.key, texts.get(item.key) ?? null)
  }
  await deps.store.persist()
  deps.fault?.("persisted")
  return captured.length
}

export async function applyVerified(deps: EngineDeps, journal: SyncJournal): Promise<Applied> {
  const resumed = (await journal.state()).cycle
  if (resumed !== null) {
    await advance(deps, journal, resumed)
    return { batches: 0, memories: resumed.keys.length }
  }
  const records = (await journal.incoming()).filter((r) => r.stage === "verified")
  if (records.length === 0) return { batches: 0, memories: 0 }
  // A cycle that ended in a crash right after clearing its record leaves its renders behind.
  await journal.clearRenders(null)
  const keys = new Set<string>()
  for (const record of records) {
    const items = record.items.map((i) => ({ key: i.key, ops: fromBase64(i.ops) }))
    if (record.snapshot) await deps.store.applySnapshot({ items })
    else for (const item of items) await deps.store.apply(item.key, item.ops)
    for (const item of items) keys.add(item.key)
  }
  await deps.store.persist()
  const state = await journal.state()
  const last = records.at(-1)?.entry.seq ?? state.applied
  const cycle: CycleRecord = {
    id: randomBytes(8).toString("hex"),
    stage: "merged",
    first: state.applied + 1,
    last,
    batches: records.map((r) => r.entry),
    keys: [...keys].sort(),
    treeId: null,
  }
  await journal.updateState({ cycle })
  deps.fault?.("merged")
  await advance(deps, journal, cycle)
  return { batches: records.filter((r) => !r.snapshot).length, memories: keys.size }
}

/** Move a staged render into place (or the working file aside, for a delete), durably. */
async function land(journal: SyncJournal, root: string, cycleId: string, record: RenderRecord): Promise<void> {
  const target = join(root, record.key)
  const staged = journal.stagedPath(cycleId, record.seq)
  if (record.text === null) {
    if (existsSync(target)) await rename(target, staged)
    else await writeAtomic(staged, "")
    await syncJournalDirectory(dirname(target))
    await syncJournalDirectory(dirname(staged))
    return
  }
  await mkdir(dirname(target), { recursive: true })
  await rename(staged, target)
  await syncJournalDirectory(dirname(target))
  // Invariant 4 reads the staged file's absence, so that side of the rename must be durable too.
  await syncJournalDirectory(dirname(staged))
}

export async function advance(deps: EngineDeps, journal: SyncJournal, start: CycleRecord): Promise<void> {
  let cycle = start
  const save = async (next: CycleRecord, point: "rendered" | "committed" | "checkpointed") => {
    cycle = next
    await journal.updateState(point === "checkpointed" ? { cycle, applied: cycle.last } : { cycle })
    deps.fault?.(point)
  }
  if (cycle.stage === "merged") {
    const latest = latestByKey(await journal.renders(cycle.id))
    for (const key of cycle.keys) {
      const working = await readWorking(deps.repo.root, key)
      const frontier = await deps.store.version(key)
      const prior = latest.get(key)
      // Invariant 6: this (key, frontier) already rendered, landed and untouched.
      if (prior !== undefined && prior.frontier === frontier && journal.renderLanded(cycle.id, prior) && textHash(working) === prior.hash) continue
      const text = deps.store.render(key, working)
      const record: RenderRecord = { seq: await journal.nextRenderSeq(cycle.id), key, frontier, hash: textHash(text), text }
      // A crash at `staged` leaves a staged file with no record at this seq; it must not survive
      // into a delete record, where a present staged file means "landed" (invariant 4).
      await removeAtomic(journal.stagedPath(cycle.id, record.seq))
      if (text !== null) await writeAtomic(journal.stagedPath(cycle.id, record.seq), text)
      deps.fault?.("staged")
      await journal.appendRender(cycle.id, record)
      deps.fault?.("render-intent")
      await land(journal, deps.repo.root, cycle.id, record)
      deps.fault?.("render-key")
    }
    const treeId = await deps.repo.stageTree(cycle.keys)
    await save({ ...cycle, stage: "rendered", treeId }, "rendered")
  }
  if (cycle.stage === "rendered") {
    const range = `${cycle.first}-${cycle.last}`
    const changed = (await deps.repo.stageTree(cycle.keys)) !== (await deps.repo.headTree())
    if (changed && !(await deps.repo.hasSyncCommit(range))) {
      const principals = [...new Set(cycle.batches.map((b) => b.author))].sort().join(", ")
      const count = cycle.keys.length
      await deps.repo.commit(cycle.keys, `sync: ${count} memories updated\n\nSync-Seq: ${range}\nSync-Principals: ${principals}`)
      deps.fault?.("git-commit")
    }
    await save({ ...cycle, stage: "committed" }, "committed")
  }
  if (cycle.stage === "committed") {
    await adoptLandedRenders(deps, journal, cycle)
    await deps.store.persist()
    await journal.recordApplied(cycle.batches)
    await save({ ...cycle, stage: "checkpointed" }, "checkpointed")
  }
  for (const batch of cycle.batches) await journal.dropIncoming(batch.seq)
  await journal.updateState({ cycle: null })
  await journal.clearRenders(null)
}
