import { AsyncLocalStorage } from "node:async_hooks"
import { createHash } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { getProcessCommandName } from "@oh-my-opencode/memory-core/process-identity"
import {
  type LockHolder,
  type LockLease,
  LockWaitTimeoutError,
  withLock,
} from "@oh-my-opencode/team-core/team-state-store/locks"
import { accountHome, lockDirectoryIn } from "./account-home"
import { serviceOrigin, SignInError } from "./protocol"

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
  try {
    return await withLock(lock, (lease) => held.run(new Map([...(owned ?? []), [lock, lease]]), () => action(lease)), {
      ownerTag,
      staleAfterMs: CREDENTIAL_LOCK_STALE_AFTER_MS,
    })
  } catch (error) {
    // Only this acquire's own wait: a timeout raised inside `action` belongs to another lock and keeps its own error.
    if (error instanceof LockWaitTimeoutError && error.lockPath === lock) throw await credentialLockBusy(error)
    throw error
  }
}

// A keychain helper finishes a mutation it already started within this long after its caller exits (helper session.c);
// a helper holding the lock for longer is stuck on a call nobody will answer.
const HELPER_FINISHING_MS = 60_000

const helperArgv0 = /(^|-)omo-keychain(-test)?$/

function duration(ms: number): string {
  const units = [
    [86_400_000, "day"],
    [3_600_000, "hour"],
    [60_000, "minute"],
    [1_000, "second"],
  ] as const
  for (const [size, unit] of units) {
    const count = Math.floor(ms / size)
    if (count >= 1) return `${count} ${unit}${count === 1 ? "" : "s"}`
  }
  return "under a second"
}

/**
 * The credential lock stayed held for the whole wait (#14029). Name the holder and the one action that frees it: a
 * keychain helper left behind by an earlier command holds it until it is killed (it ignores SIGTERM by design), so it
 * gets `kill -9`; any other process is asked to finish or be ended. Never the generic "unexpected error".
 */
async function credentialLockBusy(error: LockWaitTimeoutError): Promise<SignInError> {
  const holder: LockHolder | null = error.holder
  const name = holder === null ? null : await getProcessCommandName(holder.ownerPid)
  if (holder === null || name === null)
    return new SignInError(
      `OmO's sign-in lock stayed busy and its holder has exited or could not be read. Run the command again. If it keeps failing while no omo command is running, delete ${error.lockPath} and try again.`,
    )
  const pid = holder.ownerPid
  const age = Math.max(0, Date.now() - holder.acquiredAtEpochMs)
  const held = `has held OmO's sign-in lock (${error.lockPath}) for ${duration(age)}`
  if (pid === process.pid)
    return new SignInError(
      `This omo process (pid ${pid}) ${held} in another part of the same command and did not release it. Run the command again, and report it with /bug if it keeps failing.`,
    )
  if (helperArgv0.test(name))
    return new SignInError(
      age < HELPER_FINISHING_MS
        ? `An OmO keychain helper (pid ${pid}) ${held} and is finishing a keychain change. Try again in a minute.`
        : `An OmO keychain helper (pid ${pid}) left behind by an earlier omo command ${held}. End it with \`kill -9 ${pid}\`, then run the command again.`,
    )
  return new SignInError(
    `Another process (pid ${pid}, ${name}) ${held}. Wait for it to finish, or end it with \`kill ${pid}\`, then run the command again.`,
  )
}
