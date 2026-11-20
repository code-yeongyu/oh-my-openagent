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
import { dirname, join, relative } from "node:path"

import { existsSync, mkdir, readdir, rename, rm, stat } from "../../fs/resilient"
import { syncJournalDirectory } from "../../journal/fsync"
import { readJson, removeAtomic, writeJson } from "./atomic"
import type { EngineDeps } from "./engine-deps"
import type { SyncJournal } from "./journal"
import { CursorBeyondHeadError, type Received, receive } from "./receive"
import { itemPathsOnDisk } from "./working-tree"

interface SwitchMarker {
  readonly from: string
  readonly to: string
  /** Working-tree paths (relative to the repository root) of the sync items `from` leaves behind. */
  readonly files: readonly string[]
}

export class AccountSwitchError extends Error {
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
  if (existsSync(journal.dir) && (await journal.state()).account !== marker.to)
    await moveIfPresent(journal.dir, parkedJournal(journal, marker.from))
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

/**
 * Finishes a switch a crash interrupted, then switches to the signed-in account when the journal names another.
 * Answers whether the state changed hands, so the caller reloads the item store. A journal an older build wrote
 * names no account: it is taken as the signed-in account's (a wrong one is caught by `cursorBeyondHead`).
 */
export async function claimAccount(deps: EngineDeps, journal: SyncJournal): Promise<boolean> {
  const pending = await readJson<SwitchMarker | null>(markerPath(journal), null)
  if (pending !== null) await finish(deps, journal, pending)
  const account = deps.account
  if (account === undefined) return pending !== null
  const owner = (await journal.state()).account
  if (owner === account) return pending !== null
  if (owner === null) {
    await journal.updateState({ account })
    return pending !== null
  }
  const stale = parkedJournal(journal, owner)
  const suffix = `.retired-${Date.now()}-${randomBytes(4).toString("hex")}`
  if (existsSync(stale)) await rename(stale, `${stale}${suffix}`)
  if (existsSync(parkedTree(journal, owner)))
    await rename(parkedTree(journal, owner), `${parkedTree(journal, owner)}${suffix}`)
  const files = [...(await itemPathsOnDisk(deps.repo.root)).byKey.values()]
    .filter((path): path is string => path !== null)
    .sort()
  const marker: SwitchMarker = { from: owner, to: account, files }
  await writeJson(markerPath(journal), marker)
  await finish(deps, journal, marker)
  deps.log?.(`sync: this repository synced another account; its memories are parked and this account's are restored`)
  return true
}

/**
 * A pull that finds the server head below the applied cursor ran on another chain's journal (review L2): it is retired
 * and this chain starts over. The working files stay, so an edit the retired outbox still held is captured fresh.
 */
export async function receiveOnFreshChain(deps: EngineDeps, journal: SyncJournal, error: unknown): Promise<Received> {
  if (!(error instanceof CursorBeyondHeadError)) throw error
  deps.log?.(`sync: ${error.message}; retiring that journal and starting this account's sync over`)
  await journal.retire()
  await journal.claim(deps.store.peer(), deps.space, deps.legacySpace, deps.log)
  if (deps.account !== undefined) await journal.updateState({ account: deps.account })
  await deps.store.load()
  return receive(deps, journal)
}
