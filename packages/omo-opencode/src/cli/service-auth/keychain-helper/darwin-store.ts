import type { HelperCall, HelperLease, HelperReply } from "./client"
import { type DarwinReadDeps, HelperReadError, readThroughHelper, type ReadResult } from "./darwin-read"
import { migrate } from "./migration"
import { deleteOldSlots, namesFromRead, runRecovery } from "./recovery"

export type WriteIntent = "fresh-sign-in" | "update"

export type DarwinStoreDeps = DarwinReadDeps & {
  /** Today's overwrite of an item another identity owns (silent, m5): keeps that item's access list. */
  readonly ownOverwrite: (value: string) => Promise<void>
  /** Today's delete of `<A>` by this process's identity (may prompt, v9 3.1); `<A>.old` silently. */
  readonly ownDelete: (name: string) => Promise<boolean>
  /** One notice per process for a failed migration (v9 3.3: it never fails the section). */
  readonly notice: (message: string) => void
}

export type LockedDarwinStore = {
  readonly recover: () => Promise<void>
  readonly read: () => Promise<string | null>
  readonly settle: () => Promise<void>
  readonly write: (value: string, intent: WriteIntent) => Promise<void>
  readonly clear: () => Promise<void>
}

/** RULING-73: every retired slot holds a copy nothing here can remove; the user must delete them once. */
export class HelperOldSlotsFull extends Error {}

const OLD_SLOTS_FULL_MESSAGE =
  'The macOS keychain holds 8 earlier OmO sign-ins that cannot be removed automatically. Open Keychain Access, delete the items whose account name ends in ".old" or ".old.1" to ".old.7" for OmO, then sign in again.'

const failed = (reply: HelperReply, verb: string) =>
  new HelperReadError(reply.error === "locked" ? "locked" : "store", `The keychain helper could not ${verb} the sign-in (${reply.error ?? "no answer"}).`)

/**
 * The session-lock view (design 3.3, 3.4, 3.6): every helper mutation is handed the lease; reads never prompt (an
 * approval comes from `prepare()` before the lock); recovery runs at the start of every section, migration only from
 * `accessToken()`'s section via `settle()`.
 */
export function lockedDarwinStore(deps: DarwinStoreDeps, lease: HelperLease): LockedDarwinStore {
  const helper = (call: HelperCall) => deps.access.call(call, lease)
  const deleteOwnOld = (name: string) => deps.ownDelete(name)
  let lastRead: Extract<ReadResult, { kind: "value" }> | null = null

  const read = async () => {
    const result = await readThroughHelper(deps, false)
    lastRead = result.kind === "value" ? result : null
    return result.kind === "value" ? result.value : null
  }

  return {
    async recover() {
      const reply = await deps.access.call({ verb: "read", account: deps.account })
      if (reply.error === undefined) await runRecovery(deps.account, namesFromRead(reply), helper, deleteOwnOld)
    },
    read,
    async settle() {
      if (lastRead === null) return
      const outcome = await migrate(deps.account, lastRead.value, lastRead.source, helper, deleteOwnOld)
      if (outcome.kind === "skipped" && outcome.reason === "old-slots-full") deps.notice(`omo: ${OLD_SLOTS_FULL_MESSAGE}`)
      if (outcome.kind === "failed") deps.notice(`omo: the macOS keychain item could not be moved to OmO's keychain helper (${outcome.step}); it keeps working as before.`)
    },
    async write(value, intent) {
      const state = await deps.access.call({ verb: "read", account: deps.account })
      if (state.error !== undefined) throw failed(state, "check")
      if (state.owned === false) {
        // Row 8b applies only to an item nobody here can read: not one this process read, not one its own identity reads
        // silently, and not one a still-valid approval in this process covers.
        const approved = state.cdat !== undefined && state.mdat !== undefined && deps.cache.consume({ cdat: state.cdat, mdat: state.mdat }) !== null
        const readable = lastRead !== null || approved || (await deps.ownSilentGet().catch(() => undefined)) !== undefined
        if (readable || intent !== "fresh-sign-in") {
          await deps.ownOverwrite(value)
          if (lastRead?.source === "approved")
            await deps.cache.afterOwnWrite(value, async () => {
              const after = await deps.access.call({ verb: "read", account: deps.account })
              return after.cdat === undefined || after.mdat === undefined ? null : { cdat: after.cdat, mdat: after.mdat }
            })
          return
        }
        // A completed, user-initiated sign-in over an item nobody here can read (row 8b, ruled 2026-10-28): move the old
        // item aside by rename (no approval needed, m10) so the fresh sign-in gets an item this machine can read.
        const retired = await helper({ verb: "retire", account: deps.account })
        if (retired.reason === "old-slots-full") throw new HelperOldSlotsFull(OLD_SLOTS_FULL_MESSAGE)
        if (retired.ok !== true) throw failed(retired, "replace")
      }
      const written = await helper({ verb: "write", account: deps.account, value })
      if (written.ok !== true) throw failed(written, "save")
      lastRead = { kind: "value", value, source: "owned", reply: written }
    },
    async clear() {
      const removed = await helper({ verb: "remove", account: deps.account })
      if (removed.error === "not-owned") await deps.ownDelete(deps.account)
      else if (removed.ok !== true) throw failed(removed, "remove")
      await helper({ verb: "remove", account: `${deps.account}.staging` })
      const present = await helper({ verb: "read", account: deps.account })
      await deleteOldSlots(deps.account, present.present?.oldSlots ?? [], helper, deleteOwnOld)
      lastRead = null
    },
  }
}
