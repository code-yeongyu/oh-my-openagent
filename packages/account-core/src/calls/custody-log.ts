import { randomUUID } from "node:crypto"
import { appendFile, chmod, mkdir } from "node:fs/promises"
import { userInfo } from "node:os"
import { dirname, join } from "node:path"
import { accountHome } from "../account-home"
import { CredentialStoreError, KeychainLockedError } from "../keystore"
import { LOCK_WAIT_MS, withCustodyLock } from "./custody-lock"
import { recoverCustodyLog } from "./custody-recovery"
import { type CallOutcome, ok } from "./outcome"

// The local custody log (security design 8.2): one append-only, owner-only file in the account home, two JSON records
// per custody-bearing call (`started` before the credential store is touched, `terminal` after), joined by an operation
// id. A record has a fixed field set per phase (ids, kinds, a closed code): never a credential, a code a person types, or
// any argument a caller supplied. Kept 90 days. A call never waits on it: when it cannot be written the call runs as
// before and its answer says the audit was unavailable.

export type CustodyPrincipal = {
  readonly kind: "person" | "script" | "session" | "connector" | "service"
  readonly id: string
}
export type CustodyCapability =
  "account.signIn" | "account.signOut" | "account.forget" | "account.store.enable" | "account.store.disable"
export type CustodyOutcome = "ok" | "refused" | "cancelled" | "partial" | "failed" | "interrupted"

export type CustodyRecord = {
  readonly id: string
  readonly at: string
  readonly operation_id: string
  readonly principal: CustodyPrincipal
  readonly capability: CustodyCapability
  readonly destination: "store"
  readonly phase: "started" | "terminal"
  /** The starting process, on a `started` record: the recovery step closes an operation whose starter is gone. */
  readonly pid?: number
  readonly outcome?: CustodyOutcome
  readonly code?: string
}

export const custodyLogPath = (home: string): string => join(home, ".omo", "account-state", "custody.jsonl")

export type CustodyOperation = {
  /** Whether the `started` record was written. */
  readonly recorded: boolean
  /** Writes the `terminal` record; answers whether it was written. */
  readonly end: (outcome: CustodyOutcome, code?: string) => Promise<boolean>
}

export type CustodyLog = {
  readonly begin: (capability: CustodyCapability) => Promise<CustodyOperation>
  /** A call refused before it ran (the root's boundary): one terminal `refused` record with the refusal's code. */
  readonly refused: (capability: CustodyCapability, code: string) => Promise<boolean>
}

export function custodyLog(options: {
  readonly home: string
  readonly principal: CustodyPrincipal
  readonly now?: () => number
  /** How long one record waits for the log's lock held by a live process (custody-lock.ts); then it is unwritten. */
  readonly lockWaitMs?: number
}): CustodyLog {
  const path = custodyLogPath(options.home)
  const now = options.now ?? Date.now
  const deadline = () => Date.now() + (options.lockWaitMs ?? LOCK_WAIT_MS)
  const append = async (record: Omit<CustodyRecord, "id" | "at">): Promise<boolean> => {
    try {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      const line = `${JSON.stringify({ id: randomUUID(), at: new Date(now()).toISOString(), ...record })}\n`
      const written = await withCustodyLock(
        path,
        async () => {
          await appendFile(path, line, { mode: 0o600 })
          await chmod(path, 0o600)
          return true
        },
        deadline(),
      )
      return written === true
    } catch {
      return false
    }
  }
  const open = (capability: CustodyCapability) => ({
    operation_id: randomUUID(),
    principal: options.principal,
    capability,
    destination: "store" as const,
  })
  const recover = () => withCustodyLock(path, () => recoverCustodyLog(path, now()), deadline()).catch(() => undefined)
  return {
    async begin(capability) {
      await recover()
      const base = open(capability)
      const recorded = await append({ ...base, phase: "started", pid: process.pid })
      return {
        recorded,
        end: (outcome, code) =>
          append({ ...base, phase: "terminal", outcome, ...(code === undefined ? {} : { code }) }),
      }
    },
    async refused(capability, code) {
      await recover()
      return append({ ...open(capability), phase: "terminal", outcome: "refused", code })
    },
  }
}

/**
 * This process's own custody log in the account home, its principal the OS user running the command: a person at an
 * interactive terminal, otherwise a script (a session's shell included; the command cannot prove more).
 */
export const processCustodyLog = (): CustodyLog =>
  custodyLog({
    home: accountHome(),
    principal: {
      kind: process.stdin.isTTY === true && process.stdout.isTTY === true ? "person" : "script",
      id: String(process.getuid?.() ?? userInfo().uid),
    },
  })

/** What a CLI prints when a custody-bearing call ran but its custody record could not be written (8.2). */
export const AUDIT_UNAVAILABLE_NOTE = "omo: the custody log could not be written, so this change is not recorded in it."

/** A custody-bearing call's value, marked when a custody record could not be written; the call ran as it always has. */
export type Audited<Value> = Value & { readonly auditUnavailable?: true }

/** How a call's value reads in its terminal record, where `ok` alone does not say it (a revoke left unconfirmed). */
export type ValueOutcome<Value> = (value: Value) => { readonly outcome: "ok" | "partial"; readonly code?: string }

const failureCode = (error: unknown) =>
  error instanceof KeychainLockedError
    ? "credential_store_locked"
    : error instanceof CredentialStoreError
      ? "credential_store_unavailable"
      : "internal_error"

/** Runs a custody-bearing call between its `started` and `terminal` records; a failure is recorded, then rethrown. */
export async function audited<Value extends object, Refusal extends { readonly code: string }>(
  log: CustodyLog | undefined,
  capability: CustodyCapability,
  run: () => Promise<CallOutcome<Value, Refusal>>,
  valueOutcome?: ValueOutcome<Value>,
): Promise<CallOutcome<Audited<Value>, Refusal>> {
  if (log === undefined) return run()
  const operation = await log.begin(capability)
  let outcome: CallOutcome<Value, Refusal>
  try {
    outcome = await run()
  } catch (error) {
    await operation.end("failed", failureCode(error))
    throw error
  }
  const read =
    outcome.kind === "ok"
      ? (valueOutcome?.(outcome.value) ?? { outcome: "ok" as const })
      : { outcome: outcome.code === "cancelled" ? ("cancelled" as const) : ("refused" as const), code: outcome.code }
  const ended = await operation.end(read.outcome, read.code)
  if (outcome.kind !== "ok" || (operation.recorded && ended)) return outcome
  return ok({ ...outcome.value, auditUnavailable: true as const })
}
