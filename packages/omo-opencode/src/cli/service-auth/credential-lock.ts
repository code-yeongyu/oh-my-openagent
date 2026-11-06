import { AsyncLocalStorage } from "node:async_hooks"
import { createHash } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { type LockLease, withLock } from "@oh-my-opencode/team-core/team-state-store/locks"
import { serviceOrigin } from "./protocol"

const held = new AsyncLocalStorage<ReadonlyMap<string, LockLease>>()

/**
 * The one per-origin lock and desktop generation record (account-transport-api v7 section 4.1). The CLI, desktop main
 * and the engine pin boundary all derive these paths here or with the same inputs; never pass a path around instead.
 */
export function credentialLockPaths(api: string, home = homedir()): { readonly directory: string; readonly lock: string; readonly desktopRecord: string } {
  const id = createHash("sha256").update(serviceOrigin(api)).digest("hex")
  const directory = join(home, ".omo", "session-locks")
  return { directory, lock: join(directory, `${id}.lock`), desktopRecord: join(directory, `${id}.desktop-generation.json`) }
}

/** The lease of the origin lock this async context already holds, or undefined outside that lock. */
export function heldCredentialLease(api: string, home = homedir()): LockLease | undefined {
  return held.getStore()?.get(credentialLockPaths(api, home).lock)
}

/**
 * Writers and effect boundaries share one origin lock; nested session writes retain ownership and see the outer lease,
 * which the keychain helper needs to take the lock over for a mutation (#11262 design 3.6).
 */
export async function withCredentialLock<T>(api: string, action: (lease: LockLease) => Promise<T>, home = homedir(), ownerTag = "cli-session"): Promise<T> {
  const { directory, lock } = credentialLockPaths(api, home)
  const owned = held.getStore()
  const outer = owned?.get(lock)
  if (outer !== undefined) return action(outer)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  return withLock(lock, lease => held.run(new Map([...owned ?? [], [lock, lease]]), () => action(lease)), {
    ownerTag, staleAfterMs: Number.POSITIVE_INFINITY,
  })
}
