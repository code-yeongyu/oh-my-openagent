import { createHash } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"
import { z } from "zod"
import { withLock } from "@oh-my-opencode/team-core/team-state-store/locks"
import { buildLockRecord, isLockRecordStale } from "@oh-my-opencode/team-core/team-state-store/lock-record"
import { forgetLockRecord, markLockRecordHeld, markLockRecordReleased } from "@oh-my-opencode/team-core/team-state-store/lock-worker-lifetime"
import type { SyncRpcClaims } from "./sync-rpc-ports"

const Lease = z.object({ owner: z.string(), expiresAt: z.number().finite().nullable() }).strict()

/** The mutex protects only lease updates; the ceremony never holds it over a service wait. */
export function createSyncRpcClaims(root: string): SyncRpcClaims {
  return {
    async acquire(identity, operation, pendingId, authority) {
      authority.signal.throwIfAborted()
      const key = createHash("sha256").update(JSON.stringify([
        identity.serviceOrigin, identity.accountId, identity.serviceDeviceId, operation, pendingId ?? null,
      ])).digest("hex")
      await authority.boundary(() => mkdir(root, { recursive: true, mode: 0o700 }))
      const path = join(root, `${key}.json`)
      const lock = join(root, `${key}.lock`)
      const owner = await buildLockRecord("memory-sync")
      const read = async () => {
        try { return Lease.parse(JSON.parse(await readFile(path, "utf8"))) } catch (error) {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
          throw error
        }
      }
      const update = <T>(fn: () => Promise<T>) => withLock(lock, fn, { staleAfterMs: Infinity, ownerTag: "memory-sync-claim" })
      const acquired = await update(async () => {
        const previous = await read()
        if (previous !== null && (previous.expiresAt === null || previous.expiresAt > Date.now())
          && !(await isLockRecordStale({ content: previous.owner, modifiedAtEpochMs: 0 }, Infinity))) return false
        await authority.boundary(() => writeFile(path, JSON.stringify({ owner, expiresAt: null }), { mode: 0o600 }))
        markLockRecordHeld(owner)
        return true
      })
      if (!acquired) return null
      return {
        async expiresAt(expiresAt) {
          if (!Number.isFinite(expiresAt)) throw new TypeError("Invalid ceremony expiry")
          await update(async () => {
            const previous = await read()
            if (previous?.owner !== owner) throw new Error("The sync claim was replaced")
            await authority.boundary(() => writeFile(path, JSON.stringify({ owner, expiresAt }), { mode: 0o600 }))
          })
        },
        async release() {
          await update(async () => {
            const previous = await read()
            if (previous?.owner === owner) await rm(path, { force: true })
            markLockRecordReleased(owner)
          })
          forgetLockRecord(owner)
        },
      }
    },
  }
}
