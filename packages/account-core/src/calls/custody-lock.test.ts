import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

import { getProcessStartIdentity } from "@oh-my-opencode/memory-core/process-identity"
import { temporaryHome } from "../test-support"
import { audited, custodyLog, custodyLogPath } from "./custody-log"
import { withCustodyLock } from "./custody-lock"
import { ok } from "./outcome"

// The custody log's lock (reviews 6066498814 Y1 to Y3, the security owner's ruling on Y2): a lock is broken only when its
// holder is proven dead, a live holder's lock is never removed, a lock two waiters judge dead at once is held by one of
// them only, and an append that cannot have the lock writes nothing and says so.

async function lockAt(home: string, holder: { readonly pid: number; readonly start: string | null }) {
  const log = custodyLogPath(home)
  mkdirSync(dirname(log), { recursive: true })
  writeFileSync(`${log}.lock`, JSON.stringify(holder), { mode: 0o600 })
  return { log, lock: `${log}.lock` }
}

async function deadPid(): Promise<number> {
  const child = Bun.spawn(["true"])
  await child.exited
  return child.pid
}

const self = async () => ({ pid: process.pid, start: await getProcessStartIdentity(process.pid) })

describe("the custody log's lock", () => {
  test("#given a lock a live holder has #then it is never broken: the waiter gives up and the lock is untouched", async () => {
    const { log, lock } = await lockAt(await temporaryHome(), await self())
    const before = readFileSync(lock, "utf8")
    let ran = false
    const answer = await withCustodyLock(
      log,
      async () => {
        ran = true
      },
      Date.now() + 50,
    )
    expect({ answer, ran, lock: readFileSync(lock, "utf8") }).toEqual({ answer: undefined, ran: false, lock: before })
  })

  test("#given a lock whose holder's pid is gone #then it is broken at once, well inside the wait", async () => {
    const { log } = await lockAt(await temporaryHome(), { pid: await deadPid(), start: null })
    const started = Date.now()
    expect(await withCustodyLock(log, async () => "held", Date.now() + 1500)).toBe("held")
    expect(Date.now() - started).toBeLessThan(1500)
  })

  test("#given a lock whose pid now belongs to a process that started at another time #then it is broken", async () => {
    const own = await self()
    if (own.start === null) throw new Error("this platform reads no process start identity")
    const { log } = await lockAt(await temporaryHome(), { pid: own.pid, start: own.start.replace(/:.*$/, ":0") })
    expect(await withCustodyLock(log, async () => "held", Date.now() + 1500)).toBe("held")
  })

  test("#given twenty waiters over one dead holder's lock, ten rounds #then never two hold it at once", async () => {
    for (let round = 0; round < 10; round++) {
      const { log } = await lockAt(await temporaryHome(), { pid: await deadPid(), start: null })
      let inside = 0
      let most = 0
      const held = await Promise.all(
        Array.from({ length: 20 }, () =>
          withCustodyLock(
            log,
            async () => {
              inside++
              most = Math.max(most, inside)
              await new Promise<void>((resolve) => setImmediate(resolve))
              inside--
              return true
            },
            Date.now() + 5000,
          ),
        ),
      )
      expect({ round, most, held: held.filter(Boolean).length }).toEqual({ round, most: 1, held: 20 })
    }
  })

  test("#given the lock held by a live process #when a sign-out runs #then it writes no record and says the audit was unavailable", async () => {
    const home = await temporaryHome()
    const { log } = await lockAt(home, await self())
    const answer = await audited(
      custodyLog({ home, principal: { kind: "person", id: "501" }, lockWaitMs: 50 }),
      "account.signOut",
      async () => ok({ signedOut: true, revoked: true }),
    )
    expect(answer).toEqual({ kind: "ok", value: { signedOut: true, revoked: true, auditUnavailable: true } })
    expect(await Bun.file(log).exists()).toBe(false)
  })

  test("#given a lock that names no holder, older than the grace #then it is broken; a fresh one is not", async () => {
    const home = await temporaryHome()
    const { log, lock } = await lockAt(home, await self())
    writeFileSync(lock, "")
    expect(await withCustodyLock(log, async () => "held", Date.now() + 50)).toBeUndefined()
    const old = new Date(Date.now() - 60_000)
    utimesSync(lock, old, old)
    expect(await withCustodyLock(log, async () => "held", Date.now() + 1500)).toBe("held")
  })

  test("#given a dead holder's lock and a dead holder's break lock #then both are cleared and the lock is taken", async () => {
    const { log, lock } = await lockAt(await temporaryHome(), { pid: await deadPid(), start: null })
    writeFileSync(`${lock}.break`, JSON.stringify({ pid: await deadPid(), start: null }))
    expect(await withCustodyLock(log, async () => "held", Date.now() + 1500)).toBe("held")
    expect([existsSync(lock), existsSync(`${lock}.break`)]).toEqual([false, false])
  })

  test("#given a live process holding the lock #when a sign-out runs #then the whole call waits one budget, not one per record", async () => {
    const home = await temporaryHome()
    await lockAt(home, await self())
    const budget = 300
    const started = Date.now()
    await audited(
      custodyLog({ home, principal: { kind: "person", id: "501" }, lockWaitMs: budget }),
      "account.signOut",
      async () => ok({ signedOut: true, revoked: true }),
    )
    expect(Date.now() - started).toBeLessThan(budget * 2)
  })
})
