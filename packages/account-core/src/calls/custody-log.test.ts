import { describe, expect, test } from "bun:test"
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

import { temporaryHome } from "../test-support"
import { type CustodyRecord, audited, custodyLog, custodyLogPath } from "./custody-log"
import { ok, refusedWith } from "./outcome"

// Security design 8.2 for slice A1b: account.signOut and account.forget write a `started` record before the store is
// touched and a `terminal` record after, joined by one operation id, with ids, kinds and codes only; they never wait on
// the log, and an operation an earlier run left open is closed as a gap.

const principal = { kind: "person", id: "501" } as const
const records = (home: string): CustodyRecord[] =>
  readFileSync(custodyLogPath(home), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CustodyRecord)

describe("the custody log", () => {
  test("#given a forget that succeeds #then a started record precedes the store change and a terminal ok joins it", async () => {
    const home = await temporaryHome()
    const log = custodyLog({ home, principal })
    let seenAtRun: CustodyRecord[] = []
    const answer = await audited(log, "account.forget", "dev-1", async () => {
      seenAtRun = records(home)
      return ok({ forgotten: true })
    })
    expect(answer).toEqual({ kind: "ok", value: { forgotten: true } })
    expect(seenAtRun.map((record) => record.phase)).toEqual(["started"])
    const [started, terminal] = records(home)
    expect(started).toMatchObject({
      phase: "started",
      capability: "account.forget",
      target: { device: "dev-1" },
      principal,
    })
    expect(terminal).toMatchObject({ phase: "terminal", outcome: "ok", operation_id: started?.operation_id })
    expect(statSync(custodyLogPath(home)).mode & 0o777).toBe(0o600)
  })

  test("#given a refused call and a failing one #then each terminal record carries its outcome and code, and the failure is rethrown", async () => {
    const home = await temporaryHome()
    const log = custodyLog({ home, principal })
    await audited(log, "account.forget", "dev-2", async () => refusedWith({ code: "other_device" }))
    await expect(
      audited(log, "account.signOut", undefined, async () => {
        throw new TypeError("synthetic failure")
      }),
    ).rejects.toThrow("synthetic failure")
    expect(records(home).filter((record) => record.phase === "terminal")).toMatchObject([
      { capability: "account.forget", outcome: "refused", code: "other_device" },
      { capability: "account.signOut", outcome: "failed", code: "TypeError" },
    ])
  })

  test("#given a log that cannot be written #when a sign-out runs #then it runs as before and says the audit was unavailable", async () => {
    const home = await temporaryHome()
    mkdirSync(dirname(dirname(custodyLogPath(home))), { recursive: true })
    writeFileSync(dirname(custodyLogPath(home)), "a file where the log directory should be")
    let ran = false
    const answer = await audited(custodyLog({ home, principal }), "account.signOut", undefined, async () => {
      ran = true
      return ok({ signedOut: true, revoked: true })
    })
    expect(ran).toBe(true)
    expect(answer).toEqual({ kind: "ok", value: { signedOut: true, revoked: true, auditUnavailable: true } })
  })

  test("#given an operation an earlier run started and never ended #when the next call begins #then the gap is recorded", async () => {
    const home = await temporaryHome()
    const log = custodyLog({ home, principal })
    const open = await log.begin("account.forget")
    await audited(log, "account.signOut", undefined, async () => ok({ signedOut: true, revoked: true }))
    expect(records(home).filter((record) => record.capability === "audit.gap")).toMatchObject([
      { phase: "terminal", outcome: "failed", code: "terminal_record_missing" },
    ])
    expect(open.recorded).toBe(true)
  })

  test("#given records older than 90 days #when the next call begins #then they are pruned", async () => {
    const home = await temporaryHome()
    let now = Date.parse("2026-01-01T00:00:00Z")
    const log = custodyLog({ home, principal, now: () => now })
    await audited(log, "account.signOut", undefined, async () => ok({ signedOut: true, revoked: true }))
    now += 91 * 24 * 60 * 60 * 1000
    await audited(log, "account.signOut", undefined, async () => ok({ signedOut: true, revoked: true }))
    expect(records(home).map((record) => record.at)).toEqual([new Date(now).toISOString(), new Date(now).toISOString()])
  })

  test("#given a call whose value and target carry text #then a record holds ids, kinds and codes only", async () => {
    const home = await temporaryHome()
    await audited(custodyLog({ home, principal }), "account.forget", "dev-1", async () =>
      ok({ forgotten: true, secret: "custody-canary-value" }),
    )
    const text = readFileSync(custodyLogPath(home), "utf8")
    expect(text).not.toContain("custody-canary-value")
    for (const record of records(home))
      expect(Object.keys(record).toSorted()).toEqual(
        expect.arrayContaining(["at", "capability", "destination", "id", "operation_id", "phase", "principal"]),
      )
  })
})
