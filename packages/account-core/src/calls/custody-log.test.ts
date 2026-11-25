import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

import { KeychainLockedError } from "../keystore"
import { temporaryHome } from "../test-support"
import { type CustodyRecord, audited, custodyLog, custodyLogPath } from "./custody-log"
import { ok, refusedWith } from "./outcome"

// Security design 8.2 with the security owner's rulings on review 6065026586 (slice A1b): a fixed field set per phase,
// never a caller's argument; each operation closes its own record; an operation whose starter is gone is closed as
// interrupted by the recovery step, under the operation's own principal; a refusal at the boundary is one record.

const principal = { kind: "person", id: "501" } as const
const STARTED = ["at", "capability", "destination", "id", "operation_id", "phase", "pid", "principal"]
const TERMINAL = ["at", "capability", "destination", "id", "operation_id", "outcome", "phase", "principal"]
const records = (home: string): CustodyRecord[] =>
  readFileSync(custodyLogPath(home), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CustodyRecord)
const keysOf = (record: CustodyRecord | undefined) => Object.keys(record ?? {}).toSorted()
const withCode = (keys: readonly string[]) => [...keys, "code"].toSorted()

async function deadPid(): Promise<number> {
  const child = Bun.spawn(["true"])
  await child.exited
  return child.pid
}

const umask = process.umask()
afterEach(() => {
  process.umask(umask)
})

describe("the custody log", () => {
  test("#given a forget that succeeds #then a started record precedes the store change, a terminal ok joins it, each with its fixed fields", async () => {
    process.umask(0o022)
    const home = await temporaryHome()
    let seenAtRun: CustodyRecord[] = []
    const answer = await audited(custodyLog({ home, principal }), "account.forget", async () => {
      seenAtRun = records(home)
      return ok({ forgotten: true })
    })
    expect(answer).toEqual({ kind: "ok", value: { forgotten: true } })
    expect(seenAtRun.map((record) => record.phase)).toEqual(["started"])
    const [started, terminal] = records(home)
    expect(started).toMatchObject({ phase: "started", capability: "account.forget", principal, pid: process.pid })
    expect(terminal).toMatchObject({ phase: "terminal", outcome: "ok", operation_id: started?.operation_id })
    expect([keysOf(started), keysOf(terminal)]).toEqual([STARTED, TERMINAL])
    expect(statSync(custodyLogPath(home)).mode & 0o777).toBe(0o600)
  })

  test("#given a refusal, a cancellation and two failures #then each terminal record carries a code from a closed set and a failure is rethrown", async () => {
    const home = await temporaryHome()
    const log = custodyLog({ home, principal })
    await audited(log, "account.forget", async () => refusedWith({ code: "other_device" }))
    await audited(log, "account.signIn", async () => refusedWith({ code: "cancelled" }))
    await expect(
      audited(log, "account.signOut", async () => {
        throw new TypeError("custody-canary-error-name")
      }),
    ).rejects.toThrow()
    await expect(
      audited(log, "account.store.enable", async () => {
        throw new KeychainLockedError("locked")
      }),
    ).rejects.toThrow()
    const terminals = records(home).filter((record) => record.phase === "terminal")
    expect(terminals.map(({ capability, outcome, code }) => ({ capability, outcome, code }))).toEqual([
      { capability: "account.forget", outcome: "refused", code: "other_device" },
      { capability: "account.signIn", outcome: "cancelled", code: "cancelled" },
      { capability: "account.signOut", outcome: "failed", code: "internal_error" },
      { capability: "account.store.enable", outcome: "failed", code: "credential_store_locked" },
    ])
    for (const record of terminals) expect(keysOf(record)).toEqual(withCode(TERMINAL))
  })

  test("#given a value the call classes as partial #then the terminal record says partial with its code", async () => {
    const home = await temporaryHome()
    await audited(
      custodyLog({ home, principal }),
      "account.signOut",
      async () => ok({ signedOut: true, revoked: false }),
      (value) => (value.revoked ? { outcome: "ok" } : { outcome: "partial", code: "revoke_unconfirmed" }),
    )
    expect(records(home).at(-1)).toMatchObject({ outcome: "partial", code: "revoke_unconfirmed" })
  })

  test("#given a log that cannot be written #when a sign-out runs #then it runs as before and says the audit was unavailable", async () => {
    const home = await temporaryHome()
    mkdirSync(dirname(dirname(custodyLogPath(home))), { recursive: true })
    writeFileSync(dirname(custodyLogPath(home)), "a file where the log directory should be")
    let ran = false
    const answer = await audited(custodyLog({ home, principal }), "account.signOut", async () => {
      ran = true
      return ok({ signedOut: true, revoked: true })
    })
    expect(ran).toBe(true)
    expect(answer).toEqual({ kind: "ok", value: { signedOut: true, revoked: true, auditUnavailable: true } })
  })

  test("#given an operation still running in another log on the same home #when a second call runs #then the first is left open and closes itself", async () => {
    const home = await temporaryHome()
    const first = await custodyLog({ home, principal }).begin("account.forget")
    const other = { kind: "script", id: "777" } as const
    await audited(custodyLog({ home, principal: other }), "account.signOut", async () =>
      ok({ signedOut: true, revoked: true }),
    )
    await first.end("ok")
    const mine = records(home).filter((record) => record.capability === "account.forget")
    expect(mine.map(({ phase, outcome, principal: who }) => ({ phase, outcome, who }))).toEqual([
      { phase: "started", outcome: undefined, who: principal },
      { phase: "terminal", outcome: "ok", who: principal },
    ])
  })

  test("#given an operation whose starter has ended #when the log opens #then recovery closes it as interrupted under its own principal", async () => {
    const home = await temporaryHome()
    const starter = { kind: "session", id: "01-session" } as const
    const pid = await deadPid()
    mkdirSync(dirname(custodyLogPath(home)), { recursive: true })
    const at = new Date().toISOString()
    const started = { id: "r1", at, operation_id: "op-1", principal: starter, capability: "account.forget" }
    writeFileSync(
      custodyLogPath(home),
      `${JSON.stringify({ ...started, destination: "store", phase: "started", pid })}\n`,
      { mode: 0o600 },
    )
    await custodyLog({ home, principal }).refused("account.signOut", "sender_not_allowed")
    const closing = records(home).find((record) => record.operation_id === "op-1" && record.phase === "terminal")
    expect(closing).toMatchObject({
      principal: starter,
      capability: "account.forget",
      outcome: "interrupted",
      code: "starter_ended",
    })
    expect(keysOf(closing)).toEqual(withCode(TERMINAL))
  })

  test("#given a refusal at the boundary #then one terminal refused record, the fixed fields and the code only", async () => {
    const home = await temporaryHome()
    expect(await custodyLog({ home, principal }).refused("account.forget", "sender_not_allowed")).toBe(true)
    const [record, ...rest] = records(home)
    expect(rest).toEqual([])
    expect(record).toMatchObject({ phase: "terminal", outcome: "refused", code: "sender_not_allowed", principal })
    expect(keysOf(record)).toEqual(withCode(TERMINAL))
  })

  test("#given records older than 90 days #when the next call begins #then they are pruned", async () => {
    const home = await temporaryHome()
    let now = Date.parse("2026-01-01T00:00:00Z")
    const log = custodyLog({ home, principal, now: () => now })
    await audited(log, "account.signOut", async () => ok({ signedOut: true, revoked: true }))
    now += 91 * 24 * 60 * 60 * 1000
    await audited(log, "account.signOut", async () => ok({ signedOut: true, revoked: true }))
    expect(records(home).map((record) => record.at)).toEqual([new Date(now).toISOString(), new Date(now).toISOString()])
  })

  test("#given a call whose value carries text #then no record holds it", async () => {
    const home = await temporaryHome()
    await audited(custodyLog({ home, principal }), "account.forget", async () =>
      ok({ forgotten: true, secret: "custody-canary-value" }),
    )
    expect(readFileSync(custodyLogPath(home), "utf8")).not.toContain("custody-canary-value")
  })
})
