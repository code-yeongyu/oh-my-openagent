import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

import { temporaryHome } from "../test-support"
import { type CustodyRecord, audited, custodyLog, custodyLogPath } from "./custody-log"
import { ok } from "./outcome"
import { processScope, processStart } from "./process-scope"

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
    const pid = livePid()
    seed(home, [
      started({
        at: old,
        operation_id: "op-open",
        pid,
        starter_start: await processStart(pid),
        starter_scope: await processScope(),
      }),
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

describe("the starter's start identity and scope (security design 8.2, D22-17)", () => {
  const OLD = "2020-01-01T00:00:00.000Z"
  const fresh = () => new Date().toISOString()
  const outcomeOf = (home: string, operation: string) =>
    records(home)
      .filter((record) => record.operation_id === operation && record.phase === "terminal")
      .map((record) => `${record.outcome} ${record.code}`)
  const run = (home: string) => custodyLog({ home, principal }).refused("account.signOut", "sender_not_allowed")

  test("#given a started record whose pid a later process took, in this scope #then it is closed as interrupted", async () => {
    const home = await temporaryHome()
    const pid = livePid()
    seed(home, [
      started({
        at: fresh(),
        operation_id: "op-reused",
        pid,
        starter_start: "an-earlier-start",
        starter_scope: await processScope(),
      }),
    ])
    await run(home)
    expect(outcomeOf(home, "op-reused")).toEqual(["interrupted starter_ended"])
  })

  test("#given a live starter with the same pid and start, in this scope #then it is kept open", async () => {
    const home = await temporaryHome()
    const pid = livePid()
    seed(home, [
      started({
        at: fresh(),
        operation_id: "op-live",
        pid,
        starter_start: await processStart(pid),
        starter_scope: await processScope(),
      }),
    ])
    await run(home)
    expect(outcomeOf(home, "op-live")).toEqual([])
  })

  test("#given a starter in another scope whose pid is absent here #then it stays open until the horizon, then closes with its reason", async () => {
    const home = await temporaryHome()
    const pid = await deadPid()
    const foreign = { pid, starter_start: "another-boot:1", starter_scope: "another-scope" }
    seed(home, [
      started({ at: fresh(), operation_id: "op-young", ...foreign }),
      started({ at: OLD, operation_id: "op-old", ...foreign }),
    ])
    await run(home)
    expect({ young: outcomeOf(home, "op-young"), old: outcomeOf(home, "op-old") }).toEqual({
      young: [],
      old: ["interrupted starter_scope_unreachable"],
    })
  })

  test("#given a record from before D22-17 whose pid is taken #then it is kept before the horizon and closed after it", async () => {
    const home = await temporaryHome()
    const pid = livePid()
    seed(home, [
      started({ at: fresh(), operation_id: "op-young", pid }),
      started({ at: OLD, operation_id: "op-old", pid }),
    ])
    await run(home)
    expect({ young: outcomeOf(home, "op-young"), old: outcomeOf(home, "op-old") }).toEqual({
      young: [],
      old: ["interrupted starter_legacy_unverified"],
    })
  })

  // Custody review of 09d971691e, L1 and L2 (design lane ruling): a scope or start identity the writer could not read is UNKNOWN,
  // never "no scope": its pid proves nothing either way, so it is not closed early and is closed at the horizon with its
  // own reason.
  test("#given a starter whose scope was written as unreadable (null) and whose pid is absent here #then it stays open until the horizon, then closes as identity unknown", async () => {
    const home = await temporaryHome()
    const unknown = { pid: await deadPid(), starter_start: null, starter_scope: null }
    seed(home, [
      started({ at: fresh(), operation_id: "op-young", ...unknown }),
      started({ at: OLD, operation_id: "op-old", ...unknown }),
    ])
    await run(home)
    expect({ young: outcomeOf(home, "op-young"), old: outcomeOf(home, "op-old") }).toEqual({
      young: [],
      old: ["interrupted starter_identity_unknown"],
    })
  })

  test("#given a starter whose scope was written as unreadable (null) and whose pid is taken #then it is closed at the horizon as identity unknown", async () => {
    const home = await temporaryHome()
    seed(home, [started({ at: OLD, operation_id: "op-old", pid: livePid(), starter_start: null, starter_scope: null })])
    await run(home)
    expect(outcomeOf(home, "op-old")).toEqual(["interrupted starter_identity_unknown"])
  })

  test("#given a starter in this scope whose start identity was unreadable (null) and whose pid is taken #then it stays open until the horizon, then closes as identity unknown", async () => {
    const home = await temporaryHome()
    const pid = livePid()
    const scope = await processScope()
    seed(home, [
      started({ at: fresh(), operation_id: "op-young", pid, starter_start: null, starter_scope: scope }),
      started({ at: OLD, operation_id: "op-old", pid, starter_start: null, starter_scope: scope }),
    ])
    await run(home)
    expect({ young: outcomeOf(home, "op-young"), old: outcomeOf(home, "op-old") }).toEqual({
      young: [],
      old: ["interrupted starter_identity_unknown"],
    })
  })
})
