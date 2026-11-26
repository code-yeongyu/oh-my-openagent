import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

import { temporaryHome } from "../test-support"
import { audited, custodyLog, custodyLogPath } from "./custody-log"
import { FOREIGN_SCOPE_BREAK_AGE_MS, HOLDERLESS_BREAK_AGE_MS, type LockWait, withCustodyLock } from "./custody-lock"
import { ok } from "./outcome"
import { processScope, processStart } from "./process-scope"

// The custody log's lock (security design 8.2, decision D22-17; reviews 6066498814 Y2, 6067451001 L1, 6067671766 N1 and
// L3): a same-scope holder's lock is broken only when that holder is proven gone, never by age; a lock naming a holder in
// another scope is broken only past FOREIGN_SCOPE_BREAK_AGE_MS; one naming no holder past HOLDERLESS_BREAK_AGE_MS. Two
// waiters never hold it at once, a wait ends a patience after the holder last changed, and each record waits on its own.

type Holder = { readonly pid: number; readonly start: string | null; readonly scope?: string | null }

function lockAt(home: string, holder: Holder | string) {
  const log = custodyLogPath(home)
  mkdirSync(dirname(log), { recursive: true })
  writeFileSync(`${log}.lock`, typeof holder === "string" ? holder : JSON.stringify(holder), { mode: 0o600 })
  return { log, lock: `${log}.lock` }
}

function ageBy(path: string, ms: number) {
  const then = new Date(Date.now() - ms)
  utimesSync(path, then, then)
}

async function deadPid(): Promise<number> {
  const child = Bun.spawn(["true"])
  await child.exited
  return child.pid
}

const self = async (): Promise<Holder> => ({
  pid: process.pid,
  start: await processStart(process.pid),
  scope: await processScope(),
})

const wait = (patienceMs: number, capMs = patienceMs * 4): LockWait => ({ patienceMs, capMs })
const held = (log: string, patienceMs: number) => withCustodyLock(log, async () => "held", wait(patienceMs))

describe("the custody log's lock", () => {
  test("#given a lock a live holder in this scope has, aged past every break age #then it is never broken", async () => {
    const { log, lock } = lockAt(await temporaryHome(), await self())
    ageBy(lock, FOREIGN_SCOPE_BREAK_AGE_MS * 2)
    const before = readFileSync(lock, "utf8")
    expect({ answer: await held(log, 50), lock: readFileSync(lock, "utf8") }).toEqual({
      answer: undefined,
      lock: before,
    })
  })

  test("#given a lock whose holder's pid is gone in this scope #then it is broken at once", async () => {
    const { log } = lockAt(await temporaryHome(), { pid: await deadPid(), start: null, scope: await processScope() })
    expect(await held(log, 50)).toBe("held")
  })

  test("#given a lock whose pid now names a process that started at another time, in this scope #then it is broken", async () => {
    const own = await self()
    const { log } = lockAt(await temporaryHome(), { ...own, start: `${own.start}-earlier` })
    expect(await held(log, 50)).toBe("held")
  })

  test("#given a lock naming a holder in another scope, its pid absent here #then it survives the holderless age and breaks past its own", async () => {
    const foreign: Holder = { pid: await deadPid(), start: "another-boot:1", scope: "another-scope" }
    const { log, lock } = lockAt(await temporaryHome(), foreign)
    ageBy(lock, HOLDERLESS_BREAK_AGE_MS + 1000)
    expect(await held(log, 50)).toBeUndefined()
    ageBy(lock, FOREIGN_SCOPE_BREAK_AGE_MS + 1000)
    expect(await held(log, 50)).toBe("held")
  })

  // Custody review of 09d971691e, L1 (design lane ruling): a holder that wrote its scope as unreadable (null) is UNKNOWN,
  // never "no scope", so its absent pid proves nothing and the lock waits the foreign-scope age.
  test("#given a lock whose holder wrote an unreadable (null) scope, its pid absent here #then it survives the holderless age and breaks past the foreign-scope age", async () => {
    const { log, lock } = lockAt(await temporaryHome(), { pid: await deadPid(), start: null, scope: null })
    expect(await held(log, 50)).toBeUndefined()
    ageBy(lock, HOLDERLESS_BREAK_AGE_MS + 1000)
    expect(await held(log, 50)).toBeUndefined()
    ageBy(lock, FOREIGN_SCOPE_BREAK_AGE_MS + 1000)
    expect(await held(log, 50)).toBe("held")
  })

  test("#given a lock that names no holder #then it is broken past the holderless age and not before", async () => {
    const { log, lock } = lockAt(await temporaryHome(), "")
    expect(await held(log, 50)).toBeUndefined()
    ageBy(lock, HOLDERLESS_BREAK_AGE_MS + 1000)
    expect(await held(log, 50)).toBe("held")
  })

  test("#given a dead holder's lock and a dead holder's break lock #then both are cleared and the lock is taken", async () => {
    const scope = await processScope()
    const { log, lock } = lockAt(await temporaryHome(), { pid: await deadPid(), start: null, scope })
    writeFileSync(`${lock}.break`, JSON.stringify({ pid: await deadPid(), start: null, scope }))
    expect(await held(log, 1500)).toBe("held")
    expect([existsSync(lock), existsSync(`${lock}.break`)]).toEqual([false, false])
  })

  test("#given twenty waiters over one dead holder's lock, ten rounds #then never two hold it at once", async () => {
    for (let round = 0; round < 10; round++) {
      const { log } = lockAt(await temporaryHome(), { pid: await deadPid(), start: null, scope: await processScope() })
      let inside = 0
      let most = 0
      const taken = await Promise.all(
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
            wait(2000, 10_000),
          ),
        ),
      )
      expect({ round, most, taken: taken.filter(Boolean).length }).toEqual({ round, most: 1, taken: 20 })
    }
  })

  test("#given a holder that keeps changing for longer than the patience #then the waiter is not starved and gets the lock", async () => {
    const own = await self()
    const { log, lock } = lockAt(await temporaryHome(), own)
    let turn = 0
    const moving = setInterval(() => writeFileSync(lock, JSON.stringify({ ...own, turn: ++turn })), 60)
    setTimeout(() => {
      clearInterval(moving)
      rmSync(lock, { force: true })
    }, 600)
    expect(await withCustodyLock(log, async () => "held", wait(200, 2000))).toBe("held")
  })

  test("#given the lock held by a live process #when a sign-out runs #then it writes no record and says the audit was unavailable", async () => {
    const home = await temporaryHome()
    const { log } = lockAt(home, await self())
    const answer = await audited(
      custodyLog({ home, principal: { kind: "person", id: "501" }, wait: wait(50) }),
      "account.signOut",
      async () => ok({ signedOut: true, revoked: true }),
    )
    expect(answer).toEqual({ kind: "ok", value: { signedOut: true, revoked: true, auditUnavailable: true } })
    expect(await Bun.file(log).exists()).toBe(false)
  })

  // Custody review of 09d971691e, L3 (b) and (c), L4 (a): each rule below had a mutant no test turned red.
  test("#given a holder that keeps changing for longer than the wait's cap #then the wait ends at the cap while the holder is still there", async () => {
    const own = await self()
    const { log, lock } = lockAt(await temporaryHome(), own)
    let turn = 0
    const moving = setInterval(() => writeFileSync(lock, JSON.stringify({ ...own, turn: ++turn })), 40)
    try {
      expect(await withCustodyLock(log, async () => "held", wait(300, 600))).toBeUndefined()
      expect(existsSync(lock)).toBe(true)
    } finally {
      clearInterval(moving)
    }
  })

  test("#given a lock this process takes #then the lock file names its pid, start identity and scope", async () => {
    const home = await temporaryHome()
    const log = custodyLogPath(home)
    mkdirSync(dirname(log), { recursive: true })
    const written = await withCustodyLock(log, async () => JSON.parse(readFileSync(`${log}.lock`, "utf8")) as unknown)
    expect(written).toEqual(await self())
  })

  test("#given a dead holder's lock while a live breaker holds the break lock #then no other waiter breaks it", async () => {
    const { log, lock } = lockAt(await temporaryHome(), {
      pid: await deadPid(),
      start: null,
      scope: await processScope(),
    })
    writeFileSync(`${lock}.break`, JSON.stringify(await self()))
    expect(await held(log, 50)).toBeUndefined()
    expect(existsSync(lock)).toBe(true)
  })

  test("#given an operation that outlasts the wait and a brief holder at its end #then its terminal record waits and is kept", async () => {
    const home = await temporaryHome()
    const log = custodyLog({ home, principal: { kind: "person", id: "501" }, wait: wait(300) })
    const answer = await audited(log, "account.signIn", async () => {
      await Bun.sleep(400)
      const { lock } = lockAt(home, await self())
      setTimeout(() => rmSync(lock, { force: true }), 50)
      return ok({ signedIn: true })
    })
    const phases = readFileSync(custodyLogPath(home), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => (JSON.parse(line) as { readonly phase: string }).phase)
    expect({ answer, phases }).toEqual({
      answer: { kind: "ok", value: { signedIn: true } },
      phases: ["started", "terminal"],
    })
  })
})
