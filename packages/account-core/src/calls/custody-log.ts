import { randomUUID } from "node:crypto"
import { userInfo } from "node:os"
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { accountHome } from "../account-home"
import { type CallOutcome, ok } from "./outcome"

// The local custody log (security design 8.2): one append-only, owner-only file in the account home, two JSON records
// per custody-bearing call (`started` before the credential store is touched, `terminal` after), joined by an operation
// id. A record holds ids, kinds and codes only: never a credential, a code a person types, or a caller-supplied string.
// Kept 90 days, pruned on write. A sign-out or a forget never waits on it: when it cannot be written they run as
// before and their answer says the audit was unavailable.

export type CustodyPrincipal = {
  readonly kind: "person" | "script" | "session" | "connector" | "service"
  readonly id: string
}
export type CustodyCapability = "account.signOut" | "account.forget"
export type CustodyOutcome = "ok" | "refused" | "cancelled" | "partial" | "failed"

export type CustodyRecord = {
  readonly id: string
  readonly at: string
  readonly operation_id: string
  readonly principal: CustodyPrincipal
  readonly capability: CustodyCapability | "audit.gap"
  readonly target?: { readonly device: string }
  readonly destination: "store"
  readonly phase: "started" | "terminal"
  readonly outcome?: CustodyOutcome
  readonly code?: string
}

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000

export const custodyLogPath = (home: string): string => join(home, ".omo", "account-state", "custody.jsonl")

export type CustodyOperation = {
  /** Whether the `started` record was written. */
  readonly recorded: boolean
  /** Writes the `terminal` record; answers whether it was written. */
  readonly end: (outcome: CustodyOutcome, code?: string) => Promise<boolean>
}

export type CustodyLog = {
  readonly begin: (capability: CustodyCapability, target?: string) => Promise<CustodyOperation>
}

function parse(line: string): CustodyRecord | undefined {
  try {
    return JSON.parse(line) as CustodyRecord
  } catch {
    return undefined
  }
}

// Drops records past retention and closes every operation an earlier run started and never ended, as a gap.
async function settle(path: string, now: number, principal: CustodyPrincipal): Promise<void> {
  const text = await readFile(path, "utf8").catch(() => "")
  const records = text
    .split("\n")
    .filter(Boolean)
    .map(parse)
    .filter((record) => record !== undefined)
  const kept = records.filter((record) => now - Date.parse(record.at) < RETENTION_MS)
  const ended = new Set(kept.filter((record) => record.phase === "terminal").map((record) => record.operation_id))
  const gaps = kept
    .filter((record) => record.phase === "started" && !ended.has(record.operation_id))
    .map<CustodyRecord>((record) => ({
      id: randomUUID(),
      at: new Date(now).toISOString(),
      operation_id: record.operation_id,
      principal,
      capability: "audit.gap",
      destination: "store",
      phase: "terminal",
      outcome: "failed",
      code: "terminal_record_missing",
    }))
  if (kept.length === records.length && gaps.length === 0) return
  const staging = `${path}.${process.pid}.tmp`
  await writeFile(staging, [...kept, ...gaps].map((record) => `${JSON.stringify(record)}\n`).join(""), { mode: 0o600 })
  await rename(staging, path)
}

export function custodyLog(options: {
  readonly home: string
  readonly principal: CustodyPrincipal
  readonly now?: () => number
}): CustodyLog {
  const path = custodyLogPath(options.home)
  const now = options.now ?? Date.now
  const append = async (record: Omit<CustodyRecord, "id" | "at">): Promise<boolean> => {
    try {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      await appendFile(
        path,
        `${JSON.stringify({ id: randomUUID(), at: new Date(now()).toISOString(), ...record })}\n`,
        {
          mode: 0o600,
        },
      )
      return true
    } catch {
      return false
    }
  }
  return {
    async begin(capability, target) {
      await settle(path, now(), options.principal).catch(() => undefined)
      const operation_id = randomUUID()
      const base = {
        operation_id,
        principal: options.principal,
        capability,
        ...(target === undefined ? {} : { target: { device: target } }),
        destination: "store" as const,
      }
      const recorded = await append({ ...base, phase: "started" })
      return {
        recorded,
        end: (outcome, code) =>
          append({ ...base, phase: "terminal", outcome, ...(code === undefined ? {} : { code }) }),
      }
    },
  }
}

/** This process's own custody log in the account home, its principal the OS user running it. */
export const processCustodyLog = (kind: "person" | "script"): CustodyLog =>
  custodyLog({ home: accountHome(), principal: { kind, id: String(process.getuid?.() ?? userInfo().uid) } })

/** A custody-bearing call's value, marked when a custody record could not be written; the call ran as it always has. */
export type Audited<Value> = Value & { readonly auditUnavailable?: true }

/** Runs a custody-bearing call between its `started` and `terminal` records; a failure is recorded, then rethrown. */
export async function audited<Value extends object, Refusal extends { readonly code: string }>(
  log: CustodyLog | undefined,
  capability: CustodyCapability,
  target: string | undefined,
  run: () => Promise<CallOutcome<Value, Refusal>>,
): Promise<CallOutcome<Audited<Value>, Refusal>> {
  if (log === undefined) return run()
  const operation = await log.begin(capability, target)
  let outcome: CallOutcome<Value, Refusal>
  try {
    outcome = await run()
  } catch (error) {
    await operation.end("failed", error instanceof Error ? error.name : "error")
    throw error
  }
  const ended = await operation.end(
    outcome.kind === "ok" ? "ok" : "refused",
    outcome.kind === "ok" ? undefined : outcome.code,
  )
  if (outcome.kind !== "ok" || (operation.recorded && ended)) return outcome
  return ok({ ...outcome.value, auditUnavailable: true as const })
}
