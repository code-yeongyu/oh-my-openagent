// The local half of a cycle's locked section: this device's edits become journaled pending ops
// before anything remote lands (sync-design §5). An edit larger than one batch may carry is held,
// never journaled, sliced or truncated (#12284); an older build's queued ops of that size are wound
// back into their files first, so they follow the same hold-until-it-fits path (review M1). Each
// captured item's ops go into one outbox segment as they are captured, so a capture holds an index
// entry per item, never the whole set's ops (#12286).

import { isSyncItemKey } from "../item"
import { adoptLandedRenders } from "./apply"
import { planBatches } from "./batches"
import type { EngineDeps } from "./engine-deps"
import { batchBound, heldPrint } from "./held"
import { acceptedKeys, rejectItem } from "./item-keys"
import type { CycleRecord, SyncJournal } from "./journal"
import { fsRefusal, readWorking, throughSymlink } from "./landing"
import type { PendingItem } from "./outbox"
import { diskLister, type ItemPaths, itemPaths, landingPath, scanWorkingTree } from "./working-tree"

const keyLength = (key: string): number => Buffer.byteLength(key, "utf8")

/**
 * Marks the pending entries whose ops this device's doc now holds, so the recovery below never reads
 * them again: a cycle then reads only the ops of the batch it seals (#12286). A crash before the mark
 * only repeats one recovery check, which then finds the ops already held.
 */
async function markImported(journal: SyncJournal, digests: ReadonlySet<string>): Promise<void> {
  if (digests.size === 0) return
  const now = await journal.pending()
  await journal.setPending({ ...now, items: now.items.map((item) => (digests.has(item.digest) && item.imported !== true ? { ...item, imported: true as const } : item)) })
}

/**
 * Working files by item key (#12147), with a capture receipt for every symlink (never entered, so
 * this device never sends a key a symlink here would make it refuse), every file whose name the key
 * grammar refuses, and every key two files normalize to (neither is captured).
 */
async function workingFiles(deps: EngineDeps, journal: SyncJournal): Promise<ItemPaths> {
  const tree = await scanWorkingTree(diskLister(deps.repo.root))
  for (const link of tree.symlinks) await rejectItem(deps, journal, "capture", link, "symlink")
  const paths = itemPaths(tree.files)
  for (const { path, rule } of paths.problems) await rejectItem(deps, journal, "capture", path, rule)
  for (const [key, path] of paths.byKey) {
    if (path !== null && path !== key) deps.log?.(`sync.item.normalized side=capture len=${keyLength(path)}`)
  }
  return paths
}

/**
 * The working text at `path`, or undefined (reported) when this device cannot read that path at all
 * or, for a known item the walk did not list, when its path goes through a symlink.
 */
async function readCaptured(deps: EngineDeps, journal: SyncJournal, key: string, path: string, listed: boolean): Promise<string | null | undefined> {
  try {
    if (!listed && (await throughSymlink(deps.repo.root, path))) {
      await rejectItem(deps, journal, "capture", key, "symlink")
      return undefined
    }
    return await readWorking(deps.repo.root, path)
  } catch (error) {
    const code = fsRefusal(error)
    if (code === null) throw error
    await rejectItem(deps, journal, "capture", key, code.toLowerCase())
    return undefined
  }
}

/**
 * Winds back queued ops no batch can carry (an older build journaled them before #12284). They never
 * left the device: that build threw before sealing, and this one never batches them; an outgoing
 * batch may already be on the server, so its items are never touched. The store moves first and the
 * journal second, so a crash between them only repeats a rewind that is then a no-op.
 */
async function rewindQueued(deps: EngineDeps, journal: SyncJournal): Promise<void> {
  const pending = await journal.pending()
  const carried = new Set((pending.outgoing?.items ?? []).map((item) => item.digest))
  const queued = planBatches(pending.items.filter((item) => !carried.has(item.digest)), batchBound(deps)).held
  if (queued.length === 0) return
  const rewound = new Set<string>()
  for (const key of [...new Set(queued.map((item) => item.key))]) {
    const items = queued.filter((item) => item.key === key)
    const ops: Uint8Array[] = []
    for (const item of items) ops.push(await journal.outbox.readOps(item))
    if ((await deps.store.rewind(key, ops)) === "kept") {
      deps.log?.(`sync.item.stuck len=${keyLength(key)} ops=${items.length}`)
      continue
    }
    for (const item of items) rewound.add(item.digest)
    deps.log?.(`sync.item.rewound len=${keyLength(key)} ops=${items.length}`)
  }
  if (rewound.size === 0) return
  await deps.store.persist()
  deps.fault?.("rewound")
  const now = await journal.pending()
  await journal.setPending({ ...now, items: now.items.filter((item) => !rewound.has(item.digest)) })
}

/**
 * Finishes imports a crash between journaling and importing a capture left owed (#12284, gate rounds
 * 2-3): each pending op the push would send is imported into its doc with the baseline its capture
 * recorded, so the next capture journals nothing new. Returns the keys of ops this device must not
 * import (foreign, missing deps, undecodable): they stay pending, are withheld from the push with every
 * later op of their key, and are named stuck. Oldest first; never throws for an op it cannot import (a damaged journal entry
 * fails the cycle, never the wire). Entries already marked imported are skipped unread.
 */
async function adoptJournaled(deps: EngineDeps, journal: SyncJournal): Promise<ReadonlySet<string>> {
  const sendable = planBatches((await journal.pending()).items, batchBound(deps)).batches.flat()
  const withheld = new Set<string>()
  const adopted = new Set<string>()
  for (const item of sendable) {
    if (item.imported === true) continue
    if (withheld.has(item.key) || isSyncItemKey(item.key) !== null) continue
    const outcome = await deps.store.adoptJournaled(item.key, await journal.outbox.readOps(item))
    if (outcome !== "refused") {
      adopted.add(item.digest)
      continue
    }
    withheld.add(item.key)
    deps.log?.(`sync.item.stuck len=${keyLength(item.key)} ops=1`)
  }
  // An op found "held" may sit only in the in-memory doc (a capture whose persist failed), so the doc is
  // persisted before any entry is marked: the mark promises that the doc ON DISK holds the op.
  if (adopted.size > 0) await deps.store.persist()
  await markImported(journal, adopted)
  return withheld
}

/** What a capture held back: keys too large to send (by fingerprint), and keys whose queued ops this device must withhold. */
export interface CaptureHolds {
  readonly held: ReadonlyMap<string, string>
  readonly withheld: ReadonlySet<string>
}

/**
 * Journals every local edit as pending ops, and returns the keys it held back instead, each with the
 * fingerprint of what it held (#12284): an edit larger than one batch may carry is never journaled,
 * applied or made the baseline, so it syncs once it fits. A key held last cycle whose file and doc are
 * unchanged (same fingerprint) is held again without diffing it again (review L4).
 */
export async function capture(deps: EngineDeps, journal: SyncJournal, resuming: CycleRecord | null = null): Promise<CaptureHolds> {
  await rewindQueued(deps, journal)
  const withheld = await adoptJournaled(deps, journal)
  const files = await workingFiles(deps, journal)
  // Resuming a cycle at merged: every render that landed is the base of any edit made since.
  if (resuming !== null) await adoptLandedRenders(deps, journal, resuming, files)
  const known = await acceptedKeys(deps, journal, "capture", deps.store.keys())
  const keys = [...new Set([...known, ...files.byKey.keys()])].sort()
  const prints = (await journal.state()).held?.prints ?? {}
  const captured: PendingItem[] = []
  const held = new Map<string, string>()
  const texts = new Map<string, string | null>()
  const segment = journal.outbox.segment()
  try {
    for (const key of keys) {
      const path = landingPath(files, key)
      if (path === null) continue
      const text = await readCaptured(deps, journal, key, path, files.byKey.has(key))
      if (text === undefined) continue
      const prior = prints[key]
      const unchanged = prior !== undefined && prior === heldPrint(text, await deps.store.version(key))
      const ops = unchanged ? null : await deps.store.capture(key, text)
      if (ops === null && !unchanged) continue
      // Checked before the segment sees it: a held edit is never journaled (#12284).
      if (ops === null || ops.byteLength > batchBound(deps)) {
        // The doc did not move (held ops are never imported), so this version is the one the next cycle compares.
        held.set(key, unchanged && prior !== undefined ? prior : heldPrint(text, await deps.store.version(key)))
        await rejectItem(deps, journal, "capture", key, "oversized")
        continue
      }
      captured.push(await segment.add(key, ops))
      texts.set(key, text)
    }
    await segment.finish()
  } finally {
    await segment.discard()
  }
  if (captured.length === 0) return { held, withheld }
  const pending = await journal.pending()
  const queued = new Set(pending.items.map((p) => p.digest))
  const fresh = captured.filter((c) => !queued.has(c.digest))
  await journal.setPending({ ...pending, items: [...pending.items, ...fresh] })
  deps.fault?.("captured")
  for (const item of captured) {
    await deps.store.apply(item.key, await journal.outbox.readOps(item))
    // The captured text is now what the item's doc holds; without this the next capture sees the
    // same edit again and pushes it again (and a restarted device would not reload the item).
    await deps.store.markMaterialized(item.key, texts.get(item.key) ?? null)
  }
  await deps.store.persist()
  await markImported(journal, new Set(captured.map((c) => c.digest)))
  deps.fault?.("persisted")
  return { held, withheld }
}
