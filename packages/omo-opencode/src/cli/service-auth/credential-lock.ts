import { AsyncLocalStorage } from "node:async_hooks"
import { createHash } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { withLock } from "@oh-my-opencode/team-core/team-state-store/locks"
import { serviceOrigin } from "./protocol"

const held = new AsyncLocalStorage<ReadonlySet<string>>()

/**
 * The one per-origin lock and desktop generation record (account-transport-api v7 section 4.1). The CLI, desktop main
 * and the engine pin boundary all derive these paths here or with the same inputs; never pass a path around instead.
 */
export function credentialLockPaths(api: string, home = homedir()): { readonly directory: string; readonly lock: string; readonly desktopRecord: string } {
  const id = createHash("sha256").update(serviceOrigin(api)).digest("hex")
  const directory = join(home, ".omo", "session-locks")
  return { directory, lock: join(directory, `${id}.lock`), desktopRecord: join(directory, `${id}.desktop-generation.json`) }
}

/** Writers and effect boundaries share one origin lock; nested session writes retain ownership. */
export async function withCredentialLock<T>(api: string, action: () => Promise<T>, home = homedir(), ownerTag = "cli-session"): Promise<T> {
  const { directory, lock } = credentialLockPaths(api, home)
  const owned = held.getStore()
  if (owned?.has(lock)) return action()
  await mkdir(directory, { recursive: true, mode: 0o700 })
  return withLock(lock, () => held.run(new Set([...owned ?? [], lock]), action), {
    ownerTag, staleAfterMs: Number.POSITIVE_INFINITY,
  })
}
