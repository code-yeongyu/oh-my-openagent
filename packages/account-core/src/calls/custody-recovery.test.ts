import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

import { temporaryHome } from "../test-support"
import { type CustodyRecord, audited, custodyLog, custodyLogPath } from "./custody-log"
import { ok } from "./outcome"

// Review 6065710236 on the custody log's recovery step and its lock: a starter alive in another process is never
// closed however long it runs; concurrent calls lose no record and close a dead operation once; a prune keeps every
// other line byte for byte, a line that does not parse or is not an object included.

const principal = { kind: "person", id: "501" } as const
const children: Bun.Subprocess[] = []
afterEach(() => {
  for (const child of children.splice(0)) child.kill()
})

const lines = (home: string) => readFileSync(custodyLogPath(home), "utf8").split("\n").filter(Boolean)
const records = (home: string) =>
  lines(home).flatMap((line) => {
    try {
      const value: unknown = JSON.parse(line)
      return typeof value === "object" && value !== null && !Array.isArray(value) ? [value as CustodyRecord] : []
    } catch {
      return []
    }
  })

function seed(home: string, rows: readonly string[]) {
  mkdirSync(dirname(custodyLogPath(home)), { recursive: true })
  writeFileSync(custodyLogPath(home), rows.map((row) => `${row}\n`).join(""), { mode: 0o600 })
}

const started = (fields: Partial<CustodyRecord> & { readonly at: string; readonly operation_id: string }) =>
  JSON.stringify({
    id: `r-${fields.operation_id}`,
    principal: { kind: "session", id: "01-session" },
    capability: "account.store.enable",
    destination: "store",
    phase: "started",
    ...fields,
  })

// An operation past retention that closed: both its records are the prune's to drop.
const closedLongAgo = (operation_id: string) => [
  started({ at: "2020-01-01T00:00:00.000Z", operation_id }),
  JSON.stringify({
    id: `t-${operation_id}`,
    at: "2020-01-01T00:00:00.000Z",
    operation_id,
    principal: { kind: "session", id: "01-session" },
    capability: "account.store.enable",
    destination: "store",
    phase: "terminal",
    outcome: "ok",
  }),
]

async function deadPid(): Promise<number> {
  const child = Bun.spawn(["true"])
  await child.exited
  return child.pid
}

function livePid(): number {
  const child = Bun.spawn(["sleep", "60"])
  children.push(child)
  return child.pid
}

describe("the custody log's recovery", () => {
  test("#given an operation whose starter is alive in another process, open for 61 minutes #when another call runs #then it stays open", async () => {
    const home = await temporaryHome()
    seed(home, [
      started({ at: new Date(Date.now() - 61 * 60_000).toISOString(), operation_id: "op-live", pid: livePid() }),
    ])
    await custodyLog({ home, principal }).refused("account.signOut", "sender_not_allowed")
    expect(
      records(home)
        .filter((record) => record.operation_id === "op-live")
        .map((record) => record.phase),
    ).toEqual(["started"])
  })

  test("#given a started record that names no process, past the deadline #then it is closed as interrupted, deadline passed", async () => {
    const home = await temporaryHome()
    seed(home, [started({ at: new Date(Date.now() - 61 * 60_000).toISOString(), operation_id: "op-old" })])
    await custodyLog({ home, principal }).refused("account.signOut", "sender_not_allowed")
    expect(records(home).filter((record) => record.outcome === "interrupted")).toMatchObject([
      { operation_id: "op-old", code: "deadline_passed", principal: { kind: "session", id: "01-session" } },
    ])
  })

  test("#given eight calls opening together over one dead operation #then it is closed once", async () => {
    const home = await temporaryHome()
    seed(home, [started({ at: new Date().toISOString(), operation_id: "op-dead", pid: await deadPid() })])
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        custodyLog({ home, principal: { kind: "script", id: String(index) } }).refused("account.forget", "x"),
      ),
    )
    expect(
      records(home)
        .filter((record) => record.operation_id === "op-dead")
        .map((record) => record.outcome),
    ).toEqual([undefined, "interrupted"])
  })

  test("#given a record past retention and twenty calls from twenty logs at once #then the prune loses none of theirs", async () => {
    const home = await temporaryHome()
    seed(home, [...closedLongAgo("op-expired")])
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        audited(custodyLog({ home, principal: { kind: "script", id: String(index) } }), "account.signOut", async () =>
          ok({ signedOut: true, revoked: true }),
        ),
      ),
    )
    const all = records(home)
    expect({
      expired: all.some((record) => record.operation_id === "op-expired"),
      started: all.filter((record) => record.phase === "started").length,
      terminal: all.filter((record) => record.phase === "terminal").length,
    }).toEqual({ expired: false, started: 20, terminal: 20 })
  })

  test("#given lines that do not parse, are not objects or are spaced their own way #when a prune runs #then each is kept byte for byte, and a null line does not stop recovery", async () => {
    const home = await temporaryHome()
    const odd = ["null", "5", '"text"', "[]", "{}", "not json", '{ "spaced" :  true }']
    seed(home, [
      ...closedLongAgo("op-expired"),
      ...odd,
      started({ at: new Date().toISOString(), operation_id: "op-dead", pid: await deadPid() }),
    ])
    await custodyLog({ home, principal }).refused("account.signOut", "sender_not_allowed")
    const now = lines(home)
    expect(now.slice(0, odd.length)).toEqual(odd)
    expect(
      records(home)
        .filter((record) => record.operation_id === "op-dead")
        .map((record) => record.outcome),
    ).toEqual([undefined, "interrupted"])
  })

  test("#given a started record past retention whose operation never closed #then the prune keeps it; a closed one past retention goes", async () => {
    const home = await temporaryHome()
    const old = "2020-01-01T00:00:00.000Z"
    seed(home, [
      started({ at: old, operation_id: "op-open", pid: livePid() }),
      started({ at: old, operation_id: "op-closed" }),
      JSON.stringify({
        id: "t",
        at: old,
        operation_id: "op-closed",
        principal: { kind: "session", id: "01-session" },
        capability: "account.store.enable",
        destination: "store",
        phase: "terminal",
        outcome: "ok",
      }),
    ])
    await custodyLog({ home, principal }).refused("account.signOut", "sender_not_allowed")
    expect(
      records(home)
        .map((record) => `${record.operation_id} ${record.phase}`)
        .filter((row) => row.startsWith("op-")),
    ).toEqual(["op-open started"])
  })

  test("#given a log that already exists readable by others #when the next record is written #then the file is owner-only", async () => {
    const home = await temporaryHome()
    seed(home, [])
    chmodSync(custodyLogPath(home), 0o644)
    await custodyLog({ home, principal }).refused("account.signOut", "sender_not_allowed")
    expect(statSync(custodyLogPath(home)).mode & 0o777).toBe(0o600)
  })
})
