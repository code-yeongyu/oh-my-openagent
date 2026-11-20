// The journal belongs to the account it synced (#14481). The space id comes from the binding and the device peer
// from the machine, so a sign-out of account A and a sign-in to account B over the same repository changes
// neither: without this, B resumed A's applied cursor, outbox and item docs, sealed on a base B's chain never
// had, and every push failed. On a switch the journal is parked under A's name (a later switch back restores it
// whole) and B starts from its own parked journal or an empty one. Every working file the new account's journal
// does not know is foreign to it: never captured into that account until it is imported on purpose, so the
// accounts' memories never cross.

import { createHash, randomBytes } from "node:crypto"

import { existsSync, rename } from "../../fs/resilient"
import type { EngineDeps } from "./engine-deps"
import type { SyncJournal } from "./journal"
import { itemPathsOnDisk } from "./working-tree"

function parkedDir(journalDir: string, account: string): string {
  return `${journalDir}.account-${createHash("sha256").update(account, "utf8").digest("hex").slice(0, 16)}`
}

async function moveIfPresent(from: string, to: string): Promise<boolean> {
  try {
    await rename(from, to)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
    throw error
  }
}

/**
 * Parks the journal of the account it names and brings back the signed-in account's parked journal, if any.
 * Answers the item keys the parked account's store knew, so the caller reloads the store and marks them foreign,
 * or null when the journal did not change hands. A journal an older build wrote names no account: it is taken as
 * the signed-in account's.
 */
export async function claimAccount(deps: EngineDeps, journal: SyncJournal): Promise<readonly string[] | null> {
  const account = deps.account
  if (account === undefined) return null
  const owner = (await journal.state()).account
  if (owner === account) return null
  if (owner === null) {
    await journal.updateState({ account })
    return null
  }
  const previous = [...deps.store.keys()]
  const parked = parkedDir(journal.dir, owner)
  if (existsSync(parked)) await rename(parked, `${parked}.retired-${Date.now()}-${randomBytes(4).toString("hex")}`)
  await moveIfPresent(journal.dir, parked)
  const restored = await moveIfPresent(parkedDir(journal.dir, account), journal.dir)
  deps.log?.(
    restored
      ? "sync: this repository synced another account; its journal is parked and this account's is restored"
      : "sync: this repository synced another account; its journal is parked and this account starts empty",
  )
  await journal.updateState({ account })
  return previous
}

/**
 * Records, after a switch, the previous account's memories this account does not know: those working files are
 * never captured into it. A file neither account knew (written after the switch) is the signed-in account's.
 */
export async function markForeign(deps: EngineDeps, journal: SyncJournal, previous: readonly string[]): Promise<void> {
  const known = new Set(deps.store.keys())
  const onDisk = (await itemPathsOnDisk(deps.repo.root)).byKey
  const foreign = previous.filter((key) => !known.has(key) && onDisk.has(key)).sort()
  await journal.updateState({ foreign })
  if (foreign.length > 0)
    deps.log?.(`sync: ${foreign.length} memories from another account stay local and are not synced to this one`)
}

/** The foreign keys still foreign: one this account's store has come to know (applied from its own chain) is its own. */
export async function liveForeign(deps: EngineDeps, journal: SyncJournal): Promise<Set<string>> {
  const recorded = (await journal.state()).foreign
  if (recorded.length === 0) return new Set()
  const known = new Set(deps.store.keys())
  const live = recorded.filter((key) => !known.has(key))
  if (live.length !== recorded.length) await journal.updateState({ foreign: live })
  return new Set(live)
}
