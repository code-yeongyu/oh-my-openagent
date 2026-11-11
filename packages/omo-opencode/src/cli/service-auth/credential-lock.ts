import { AsyncLocalStorage } from "node:async_hooks"
import { createHash } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { type LockLease, withLock } from "@oh-my-opencode/team-core/team-state-store/locks"
import { accountHome, lockDirectoryIn } from "./account-home"
import { serviceOrigin } from "./protocol"

export { accountHome }

const held = new AsyncLocalStorage<ReadonlyMap<string, LockLease>>()

// Age decides only for a record whose owner cannot be checked: one torn by a crash between the exclusive create and the
// record write (no fsync, so a reboot leaves it empty), or a legacy record of a dead pid. A live owner is never stale
// whatever its age. Unbounded, a torn record held the lock for good and every credential read waited out the lock-wait
// bound and failed (#12989).
const CREDENTIAL_LOCK_STALE_AFTER_MS = 60_000

/**
 * The one per-origin lock and desktop generation record (account-transport-api v7 section 4.1). The CLI, desktop main
 * and the engine pin boundary all derive these paths here or with the same inputs; never pass a path around instead.
 */
export function credentialLockPaths(
  api: string,
  home = accountHome(),
): { readonly directory: string; readonly lock: string; readonly desktopRecord: string } {
  const id = createHash("sha256").update(serviceOrigin(api)).digest("hex")
  const directory = lockDirectoryIn(home)
  return {
    directory,
    lock: join(directory, `${id}.lock`),
    desktopRecord: join(directory, `${id}.desktop-generation.json`),
  }
}

/** The lease of the origin lock this async context already holds, or undefined outside that lock. */
export function heldCredentialLease(api: string, home = accountHome()): LockLease | undefined {
  return held.getStore()?.get(credentialLockPaths(api, home).lock)
}

/**
 * Writers and effect boundaries share one origin lock; nested session writes retain ownership and see the outer lease,
 * which the keychain helper needs to take the lock over for a mutation (#11262 design 3.6).
 */
export async function withCredentialLock<T>(
  api: string,
  action: (lease: LockLease) => Promise<T>,
  home = accountHome(),
  ownerTag = "cli-session",
): Promise<T> {
  const { directory, lock } = credentialLockPaths(api, home)
  const owned = held.getStore()
  const outer = owned?.get(lock)
  if (outer !== undefined) return action(outer)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  return withLock(lock, (lease) => held.run(new Map([...(owned ?? []), [lock, lease]]), () => action(lease)), {
    ownerTag,
    staleAfterMs: CREDENTIAL_LOCK_STALE_AFTER_MS,
  })
}
