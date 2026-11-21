// The sync state belongs to the account it synced (#14481). The space id comes from the binding and the device peer
// from the machine, so a sign-out of account A and a sign-in to account B over the same repository changes
// neither: without this, B resumed A's applied cursor, outbox and item docs, sealed on a base B's chain never had,
// and every push failed. An account switch therefore swaps the WHOLE per-account state: the journal and the
// working tree's sync item files are parked under A's name (a switch back restores both), and B starts from its own
// parked state or an empty one. Only paths the engine owns (sync item keys) move; any other file stays.
//
// The swap is journaled: a marker naming the switch and the files it parks is written atomically before anything
// moves, every step is an idempotent same-filesystem rename, and a marker found at start is finished before the
// engine runs (review r1 M1). A switch therefore completes or resumes; it never leaves A's files in B's tree.

import { createHash, randomBytes } from "node:crypto"
import { basename, dirname, join, relative } from "node:path"

import { existsSync, mkdir, readdir, rename, rm, stat } from "../../fs/resilient"
import { syncJournalDirectory } from "../../journal/fsync"
import { readJson, removeAtomic, writeJson } from "./atomic"
import type { EngineDeps } from "./engine-deps"
import type { SyncJournal } from "./journal"
import { clearUndecided, ownedFileCount, takeDecision, writeUndecided } from "./ownership-apply"
import { itemPathsOnDisk } from "./working-tree"

interface SwitchMarker {
  readonly from: string
  readonly to: string
  /** Working-tree paths (relative to the repository root) of the sync items `from` leaves behind. */
  readonly files: readonly string[]
}

class AccountSwitchError extends Error {
  override readonly name = "AccountSwitchError"
}

const accountTag = (account: string): string => createHash("sha256").update(account, "utf8").digest("hex").slice(0, 16)
const parkedJournal = (journal: SyncJournal, account: string): string => `${journal.dir}.account-${accountTag(account)}`
const parkedTree = (journal: SyncJournal, account: string): string => `${parkedJournal(journal, account)}.tree`
const markerPath = (journal: SyncJournal): string => join(dirname(journal.dir), "omo-sync-switch.json")

async function moveIfPresent(from: string, to: string): Promise<boolean> {
  if (!existsSync(from) || existsSync(to)) return false
  await mkdir(dirname(to), { recursive: true })
  await rename(from, to)
  return true
}

async function filesUnder(root: string): Promise<string[]> {
  if (!existsSync(root)) return []
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  return entries.filter((d) => d.isFile()).map((d) => relative(root, join(d.parentPath, d.name)))
}

/** A rename never crosses a file system here; a repository whose git dir lives on another one is refused, not copied. */
async function assertSameFileSystem(root: string, journal: SyncJournal): Promise<void> {
  const [tree, git] = await Promise.all([stat(root), stat(dirname(journal.dir))])
  if (tree.dev !== git.dev)
    throw new AccountSwitchError(
      "memory sync cannot switch accounts: the repository and its git dir are on different file systems",
    )
}

async function finish(deps: EngineDeps, journal: SyncJournal, marker: SwitchMarker): Promise<void> {
  const root = deps.repo.root
  await assertSameFileSystem(root, journal)
  // 1. park `from`'s journal, unless it is already parked (a resumed switch) or the journal already is `to`'s.
  const hasState = existsSync(join(journal.dir, "state.json"))
  if (hasState && (await journal.state()).account !== marker.to)
    await moveIfPresent(journal.dir, parkedJournal(journal, marker.from))
  // A journal dir with no state is the empty one open.ts recreates after a crash (review r2 M2): it gives way.
  if (!hasState && existsSync(parkedJournal(journal, marker.to)) && (await filesUnder(journal.dir)).length === 0)
    await rm(journal.dir, { recursive: true, force: true })
  // 2. park `from`'s item files; a path whose parked copy exists was parked before a crash.
  const fromTree = parkedTree(journal, marker.from)
  for (const file of marker.files) await moveIfPresent(join(root, file), join(fromTree, file))
  // 3. restore `to`'s journal and item files, if `to` synced here before.
  await moveIfPresent(parkedJournal(journal, marker.to), journal.dir)
  const toTree = parkedTree(journal, marker.to)
  const kept: string[] = []
  for (const file of await filesUnder(toTree))
    if (!(await moveIfPresent(join(toTree, file), join(root, file)))) kept.push(file)
  if (kept.length === 0) await rm(toTree, { recursive: true, force: true })
  else deps.log?.(`sync: ${kept.length} memories of this account stay parked: a file of the same name is in the way`)
  await journal.updateState({ account: marker.to })
  await removeAtomic(markerPath(journal))
  await syncJournalDirectory(dirname(journal.dir))
}

const UNKNOWN_ACCOUNT = "unknown"

/** The ownership proof could not reach the service: nothing is decided, captured or uploaded until a later cycle proves it. */
export class OwnershipUnprovenError extends Error {
  override readonly name = "OwnershipUnprovenError"
  constructor(cause: unknown) {
    super("memory sync is checking which account this device's memory belongs to", { cause })
  }
}

/**
 * An older journal whose owner no record the service still keeps can show (#14491 review r3 M1): it is neither
 * adopted nor set aside, and nothing is captured or uploaded until the person chooses.
 */
export class OwnershipUndecidedError extends Error {
  override readonly name = "OwnershipUndecidedError"
  constructor() {
    super("memory sync cannot tell which account this device's memory belongs to")
  }
}

type Ownership = "own" | "other" | "undecided"

/** How many of the journal's newest applied records the proof asks the service about before it stays undecided. */
const PROOF_RECORDS = 3

/**
 * Whether a journal that names no account (an older build wrote it) belongs to the signed-in account (review r2 H2):
 * one of its newest applied records must be the row that account's server still keeps at the same seq, by batch id and
 * digest. A retained row that differs, or a head below the journal's cursor, proves another owner; so does a retained
 * row at a seq the journal only knows as a snapshot, because an account's history is never un-trimmed (review r4 L3).
 * A snapshot record proves nothing else: the service states no snapshot digest and older builds recorded none (review
 * r4 L2), and a record the service no longer keeps proves nothing either. Content the journal never synced cannot be
 * proven by the service at all (review r6 M1): a journal that applied nothing is the signed-in account's only while
 * nothing of it could leak, no queued edit and no owned file on disk; otherwise the person chooses. A repository with
 * no journal yet (this device never ran sync) is a normal enable. The pulls run outside the writer lock (sync-design
 * §5); a pull that fails proves nothing either way.
 */
async function ownership(deps: EngineDeps, dir: string, queued: boolean): Promise<Ownership> {
  if (!existsSync(join(dir, "state.json"))) return "own"
  const { applied } = await readJson<{ readonly applied: number }>(join(dir, "state.json"), { applied: 0 })
  if (applied === 0) return queued || (await ownedFileCount(deps.repo.root)) > 0 ? "undecided" : "own"
  const index = await readJson<Record<string, { readonly seq: number; readonly digest: string }>>(
    join(dir, "applied.json"),
    {},
  )
  const records = Object.entries(index)
    .filter(([, r]) => r.seq <= applied)
    .sort(([, a], [, b]) => b.seq - a.seq)
    .slice(0, PROOF_RECORDS)
  for (const [batchId, record] of records) {
    let page: Awaited<ReturnType<EngineDeps["transport"]["pull"]>>
    try {
      page = await deps.transport.pull(record.seq - 1, 1)
    } catch (error) {
      throw new OwnershipUnprovenError(error)
    }
    if (page.head < applied) return "other"
    const entry = page.entries[0]
    if (page.snapshot !== null || entry?.seq !== record.seq) continue
    if (batchId.startsWith("snapshot:")) return "other"
    return entry.batchId === batchId && entry.digest === record.digest ? "own" : "other"
  }
  return "undecided"
}

async function pruneRetired(path: string, keep: string): Promise<void> {
  const prefix = `${basename(path)}.retired-`
  for (const name of await readdir(dirname(path)))
    if (name.startsWith(prefix) && name !== basename(keep))
      await rm(join(dirname(path), name), { recursive: true, force: true })
}

async function switchAccount(deps: EngineDeps, journal: SyncJournal, from: string, to: string): Promise<void> {
  const suffix = `.retired-${Date.now()}-${randomBytes(4).toString("hex")}`
  for (const stale of [parkedJournal(journal, from), parkedTree(journal, from)])
    if (existsSync(stale)) {
      await rename(stale, `${stale}${suffix}`)
      await pruneRetired(stale, `${stale}${suffix}`)
    }
  const files = [...(await itemPathsOnDisk(deps.repo.root)).byKey.values()]
    .filter((path): path is string => path !== null)
    .sort()
  const marker: SwitchMarker = { from, to, files }
  await writeJson(markerPath(journal), marker)
  await finish(deps, journal, marker)
}

/**
 * Finishes a switch a crash interrupted, then gives the repository to the signed-in account: its own state is kept,
 * another account's is parked, and an unproven older journal is parked as an unknown account's and never uploaded; it
 * is restored once an account proves it. The moves run under the writer lock, so no memory write lands between the
 * snapshot and the renames (review r2 M3). Answers whether the state changed hands, so the caller reloads the store.
 */
/** The person chose to use this memory with `account`: the old journal is retired and every owned file is captured fresh. */
async function useHere(deps: EngineDeps, journal: SyncJournal, account: string): Promise<void> {
  await journal.retire()
  await journal.updateState({ account })
}

export async function claimAccount(deps: EngineDeps, journal: SyncJournal): Promise<boolean> {
  const pending = await readJson<SwitchMarker | null>(markerPath(journal), null)
  if (pending !== null) await deps.lock.withLock(() => finish(deps, journal, pending))
  const account = deps.account
  if (account === undefined) return pending !== null
  const owner = (await journal.state()).account
  if (owner === account) return pending !== null
  if (owner === null) {
    const verdict = await ownership(deps, journal.dir, (await journal.pending()).items.length > 0)
    if (verdict === "undecided") {
      const gitDir = dirname(journal.dir)
      const decision = await takeDecision(gitDir, deps.repo.root, account)
      if (decision === null) {
        await writeUndecided(gitDir, deps.repo.root, account, deps.clock.now())
        throw new OwnershipUndecidedError()
      }
      await clearUndecided(gitDir)
      if (decision === "use") {
        await deps.lock.withLock(() => useHere(deps, journal, account))
        deps.log?.("sync: as chosen, this device's memory now syncs to this account and is uploaded to it")
        return true
      }
    }
    if (verdict === "own") {
      await journal.updateState({ account })
      return pending !== null
    }
  }
  const unknown = parkedJournal(journal, UNKNOWN_ACCOUNT)
  const reclaim =
    owner !== null &&
    !existsSync(parkedJournal(journal, account)) &&
    existsSync(unknown) &&
    (await ownership(deps, unknown, true)) === "own"
  await deps.lock.withLock(async () => {
    if (reclaim) {
      await rename(unknown, parkedJournal(journal, account))
      await moveIfPresent(parkedTree(journal, UNKNOWN_ACCOUNT), parkedTree(journal, account))
    }
    await switchAccount(deps, journal, owner ?? UNKNOWN_ACCOUNT, account)
  })
  deps.log?.(
    owner === null
      ? "sync: local memory from another account was set aside; it is restored when that account signs in here"
      : "sync: this repository synced another account; its memories are parked and this account's are restored",
  )
  return true
}
