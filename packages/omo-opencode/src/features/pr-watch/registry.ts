import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { z } from "zod"
import { randomUUID } from "node:crypto"
import { withLock } from "@oh-my-opencode/team-core/team-state-store/locks"
import { emptyPrWatchState, prunePrWatchState, type PrWatchState } from "./state"

const eventSchema = z.object({ key: z.string(), kind: z.enum(["check_failed", "checks_passed", "comment", "conflict", "stopped"]), fact: z.string() })
const registrationSchema = z.object({
  id: z.string(), reference: z.string(), sessionID: z.string(), host: z.string().optional(), directory: z.string().optional(), generation: z.number().int().positive(), actor: z.string(),
  startedAt: z.number(), active: z.boolean(), reason: z.string().optional(), commentOnlyWakes: z.number().int().nonnegative(),
  unreadableSince: z.number().optional(), observed: z.boolean().optional(), told: z.array(z.string()),
})
const stateSchema = z.object({
  version: z.literal(1),
  registrations: z.record(z.string(), registrationSchema),
  snapshots: z.record(z.string(), z.object({
    statusFingerprint: z.string().optional(), remarksFingerprint: z.string().optional(), lastRemarksReadAt: z.number().optional(), transition: z.number().int().nonnegative(),
    details: z.object({ state: z.string(), mergeable: z.string(), head: z.string(), checks: z.array(z.object({ id: z.string(), name: z.string(), status: z.string(), conclusion: z.string().nullable(), required: z.boolean() })) }).optional(),
    activity: z.object({ remarks: z.array(z.object({ id: z.string(), author: z.string(), updatedAt: z.string(), url: z.string(), kind: z.enum(["comment", "review"]) })) }).optional(),
  })),
  nextPollAt: z.number().optional(),
  outbox: z.record(z.string(), z.object({ id: z.string(), watchID: z.string(), generation: z.number().int().positive(), events: z.array(eventSchema), messageID: z.string().optional(), retryAt: z.number().optional(), status: z.enum(["pending", "delivered"]) })),
})

// Recreated tool factories in the same host share their transaction queue. Always re-read disk.
const transactions = new Map<string, Promise<unknown>>()

export class PrWatchRegistry {
  readonly path: string
  constructor(path: string) { this.path = resolve(path) }

  read(): PrWatchState {
    if (!existsSync(this.path)) return emptyPrWatchState()
    chmodSync(this.path, 0o600)
    // Corrupt state is an explicit failure, never an empty registry that loses pending wakes.
    const state = stateSchema.parse(JSON.parse(readFileSync(this.path, "utf8")))
    // Older registries already observed their shared snapshot; do not replay initial wakes
    // on upgrade. New registrations explicitly persist observed=false.
    for (const row of Object.values(state.registrations)) row.observed ??= Boolean(state.snapshots[row.reference])
    return state
  }

  private prepareDirectory(): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    chmodSync(dirname(this.path), 0o700)
  }

  // A separate lock spans reads AND dispatch, while transactions take the short state lock.
  async withHostOwner<T>(work: () => Promise<T>): Promise<T> {
    this.prepareDirectory()
    return withLock(`${this.path}.owner.lock`, work)
  }

  transaction<T>(update: (state: PrWatchState) => T): Promise<T> {
    const previous = transactions.get(this.path) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(() => {
      this.prepareDirectory()
      return withLock(`${this.path}.state.lock`, async () => {
        const state = this.read()
        const result = update(state)
        prunePrWatchState(state)
        const temp = `${this.path}.${randomUUID()}.tmp`
        try {
          const fd = openSync(temp, "wx", 0o600)
          try {
            writeFileSync(fd, `${JSON.stringify(state)}\n`)
            fsyncSync(fd)
          } finally { closeSync(fd) }
          renameSync(temp, this.path)
          if (process.platform !== "win32") {
            const directory = openSync(dirname(this.path), "r")
            try { fsyncSync(directory) } finally { closeSync(directory) }
          }
        } finally { rmSync(temp, { force: true }) }
        return result
      })
    })
    transactions.set(this.path, current)
    void current.finally(() => {
      if (transactions.get(this.path) === current) transactions.delete(this.path)
    }).catch(() => undefined)
    return current
  }
}
