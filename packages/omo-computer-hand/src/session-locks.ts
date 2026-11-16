import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** A process the host identifies by `(pid, processStart)`, so a recycled pid never inherits it. */
export interface ProcessIdentity {
  readonly pid: number
  readonly processStart: number
}

/**
 * The per-session lock files the engine's self set reads (`sessions/<pid>.lock` under the RUNTIME
 * root, safety crate self_set/brain.rs): one file per brain process holding a local session,
 * kept while any of its sessions is open.
 */
export function createSessionLocks(dir: string): { acquire(owner: ProcessIdentity): () => void } {
  const open = new Map<number, number>()
  return {
    acquire(owner) {
      const count = open.get(owner.pid) ?? 0
      if (count === 0) {
        mkdirSync(dir, { recursive: true, mode: 0o700 })
        writeFileSync(
          join(dir, `${owner.pid}.lock`),
          JSON.stringify({ pid: owner.pid, processStart: owner.processStart }),
          { mode: 0o600 },
        )
      }
      open.set(owner.pid, count + 1)
      let released = false
      return () => {
        if (released) return
        released = true
        const left = (open.get(owner.pid) ?? 1) - 1
        if (left > 0) {
          open.set(owner.pid, left)
          return
        }
        open.delete(owner.pid)
        rmSync(join(dir, `${owner.pid}.lock`), { force: true })
      }
    },
  }
}
