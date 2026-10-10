import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { z } from "zod"
import { writeFileAtomically } from "@oh-my-opencode/utils/atomic-write"
import { emptyPrWatchState, type PrWatchState } from "./state"

const eventSchema = z.object({ key: z.string(), kind: z.enum(["check_failed", "checks_passed", "comment", "conflict", "stopped"]), fact: z.string() })
const registrationSchema = z.object({
  id: z.string(), reference: z.string(), sessionID: z.string(), directory: z.string().optional(), generation: z.number().int().positive(), actor: z.string(),
  startedAt: z.number(), active: z.boolean(), reason: z.string().optional(), commentOnlyWakes: z.number().int().nonnegative(),
  unreadableSince: z.number().optional(), told: z.array(z.string()),
})
const stateSchema = z.object({
  version: z.literal(1),
  registrations: z.record(z.string(), registrationSchema),
  snapshots: z.record(z.string(), z.object({
    statusFingerprint: z.string().optional(), remarksFingerprint: z.string().optional(), lastRemarksReadAt: z.number().optional(), transition: z.number().int().nonnegative(),
    details: z.object({ state: z.string(), mergeable: z.string(), head: z.string(), checks: z.array(z.object({ id: z.string(), name: z.string(), status: z.string(), conclusion: z.string().nullable(), required: z.boolean() })) }).optional(),
    activity: z.object({ remarks: z.array(z.object({ id: z.string(), author: z.string(), updatedAt: z.string(), url: z.string(), kind: z.enum(["comment", "review"]) })) }).optional(),
  })),
  outbox: z.record(z.string(), z.object({ id: z.string(), watchID: z.string(), generation: z.number().int().positive(), events: z.array(eventSchema), status: z.enum(["pending", "delivered"]) })),
})

// Recreated tool factories in the same host share their transaction queue. Always re-read disk.
const transactions = new Map<string, Promise<unknown>>()

export class PrWatchRegistry {
  readonly path: string
  constructor(path: string) { this.path = resolve(path) }

  read(): PrWatchState {
    if (!existsSync(this.path)) return emptyPrWatchState()
    // Corrupt state is an explicit failure, never an empty registry that loses pending wakes.
    return stateSchema.parse(JSON.parse(readFileSync(this.path, "utf8")))
  }

  transaction<T>(update: (state: PrWatchState) => T): Promise<T> {
    const previous = transactions.get(this.path) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(() => {
      const state = this.read()
      const result = update(state)
      mkdirSync(dirname(this.path), { recursive: true })
      writeFileAtomically(this.path, `${JSON.stringify(state)}\n`)
      return result
    })
    transactions.set(this.path, current)
    void current.finally(() => {
      if (transactions.get(this.path) === current) transactions.delete(this.path)
    }).catch(() => undefined)
    return current
  }
}
