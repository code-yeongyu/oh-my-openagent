import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { createLockRecord, recallWakeLockPath, recallWakeTicketDirectory, type LockRecord } from "@oh-my-opencode/memory-core"

import { withinMs } from "./sidecar.test-support"
import {
  KIBITZER_WAKE_SLOT_POLL_MS,
  KIBITZER_WAKE_SLOT_WAIT_MS,
  createKibitzerWakeSlot,
  type KibitzerWakeAdmission,
  type KibitzerWakeLease,
} from "./wake-slot"

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function locksDirectory(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "kibitzer-wake-slot-"))
  dirs.push(dir)
  return path.join(dir, "locks")
}

async function tickets(dir: string): Promise<string[]> {
  try {
    return (await readdir(recallWakeTicketDirectory(dir))).filter((name) => name.endsWith(".ticket"))
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return []
    throw error
  }
}

function acquired(admission: KibitzerWakeAdmission): KibitzerWakeLease {
  if (admission.status !== "acquired") throw new Error(`expected an acquired admission, got ${admission.status}`)
  return admission.lease
}

describe("createKibitzerWakeSlot", () => {
  test("#given the production defaults #when a slot is built from config #then the wait is bounded and the poll is a delay, never a spin", async () => {
    const slot = createKibitzerWakeSlot({ locksDirectory: await locksDirectory(), maxConcurrent: 2 })
    expect(slot.maxConcurrent).toBe(2)
    expect(KIBITZER_WAKE_SLOT_WAIT_MS).toBe(15_000)
    expect(KIBITZER_WAKE_SLOT_POLL_MS).toBe(200)
    expect(() => createKibitzerWakeSlot({ locksDirectory: "/locks", maxConcurrent: 0 })).toThrow()
  })

  test("#given ten sessions contending for two slots #when leases are released one at a time #then admission is FIFO and never more than two wakes are live", async () => {
    const dir = await locksDirectory()
    const slot = createKibitzerWakeSlot({ locksDirectory: dir, maxConcurrent: 2, waitTimeoutMs: 10_000, pollMs: 10 })
    const controller = new AbortController()
    const order: number[] = []
    const leases: Array<KibitzerWakeLease | undefined> = []
    let live = 0
    let peak = 0
    const waits = Array.from({ length: 10 }, (_, session) =>
      slot.acquire(controller.signal).then((admission) => {
        const lease = acquired(admission)
        order.push(session)
        leases[session] = lease
        live += 1
        peak = Math.max(peak, live)
        return admission
      }),
    )

    try {
      await withinMs(Promise.all([waits[0], waits[1]]), "the first two admissions", 5_000)
      expect(order).toEqual([0, 1])

      for (let next = 2; next < 10; next += 1) {
        const releasing = leases[next - 2]
        if (releasing === undefined) throw new Error(`session ${next - 2} never acquired`)
        live -= 1
        expect(await releasing.release()).toBe(true)
        await withinMs(waits[next] ?? Promise.resolve(), `admission ${next}`, 5_000)
        expect(order).toEqual(Array.from({ length: next + 1 }, (_, index) => index))
        expect(live).toBe(2)
      }

      expect(peak).toBe(2)
      expect(await tickets(dir)).toEqual([])
      for (const lease of leases.slice(8)) expect(await lease?.release()).toBe(true)
    } finally {
      controller.abort()
      await Promise.allSettled(waits)
      await Promise.all(leases.map(async (lease) => { await lease?.release() }))
    }
  })

  test("#given both slots held #when a wake waits its whole budget #then it is reported busy with the time it waited, leaves no ticket, and a released slot admits it", async () => {
    const dir = await locksDirectory()
    const slot = createKibitzerWakeSlot({ locksDirectory: dir, maxConcurrent: 2, waitTimeoutMs: 300, pollMs: 25 })
    const first = acquired(await slot.acquire())
    const second = acquired(await slot.acquire())

    const started = Date.now()
    const refused = await withinMs(slot.acquire(), "the busy admission", 5_000)

    expect(refused.status).toBe("busy")
    if (refused.status !== "busy") throw new Error("unreachable")
    expect(refused.waitedMs).toBeGreaterThanOrEqual(300)
    expect(Date.now() - started).toBeGreaterThanOrEqual(300)
    expect(await tickets(dir)).toEqual([])

    expect(await first.release()).toBe(true)
    const admitted = await withinMs(slot.acquire(), "the admission after a release", 5_000)
    expect(admitted.status).toBe("acquired")
    expect(acquired(admitted).slot).toBe(1)
    await Promise.all([acquired(admitted).release(), second.release()])
  })

  test("#given a wake parked behind two live holders #when the session shuts down #then the wait ends as aborted without a ticket left behind", async () => {
    const dir = await locksDirectory()
    const slot = createKibitzerWakeSlot({ locksDirectory: dir, maxConcurrent: 2, waitTimeoutMs: 60_000, pollMs: 10 })
    const first = acquired(await slot.acquire())
    const second = acquired(await slot.acquire())
    const controller = new AbortController()

    const waiting = slot.acquire(controller.signal)
    controller.abort()

    expect(await withinMs(waiting, "the aborted admission", 5_000)).toEqual({ status: "aborted" })
    expect(await tickets(dir)).toEqual([])
    await Promise.all([first.release(), second.release()])
  })

  test("#given a dead owner on the lease #when a wake arrives #then the slot is reclaimed only on the pid/start proof, and a live owner is never stolen", async () => {
    const dir = await locksDirectory()
    const slot = createKibitzerWakeSlot({ locksDirectory: dir, maxConcurrent: 1, waitTimeoutMs: 300, pollMs: 25 })
    const own = await createLockRecord("recall-wake")
    if (own.process_start === "unavailable") throw new Error("this host cannot prove process identity; the wake-slot tests need it")
    await mkdir(dir, { recursive: true })

    // A live owner (this very process) keeps the slot: the wake waits and leaves busy, the record untouched.
    const liveRecord = `${JSON.stringify(own)}\n`
    await writeFile(recallWakeLockPath(dir, 1), liveRecord)
    const refused = await withinMs(slot.acquire(), "the busy admission against a live owner", 5_000)
    expect(refused.status).toBe("busy")
    expect(await readFile(recallWakeLockPath(dir, 1), "utf8")).toBe(liveRecord)

    // A dead pid is proof: the slot is reclaimed and re-recorded for the new owner.
    const dead: LockRecord = { ...own, pid: 99_999_999, process_start: "proc-start-epoch:0" }
    await writeFile(recallWakeLockPath(dir, 1), `${JSON.stringify(dead)}\n`)
    const reclaimed = await withinMs(slot.acquire(), "the reclaimed admission", 5_000)
    expect(reclaimed.status).toBe("acquired")
    expect((JSON.parse(await readFile(recallWakeLockPath(dir, 1), "utf8")) as LockRecord).nonce).not.toBe(dead.nonce)
    expect(await acquired(reclaimed).release()).toBe(true)

    // A live pid with an unprovable identity is NOT proof: nothing is stolen.
    const unprovable: LockRecord = { ...own, process_start: "unavailable" }
    const unprovableRecord = `${JSON.stringify(unprovable)}\n`
    await writeFile(recallWakeLockPath(dir, 1), unprovableRecord)
    expect((await withinMs(slot.acquire(), "the busy admission against an unprovable owner", 5_000)).status).toBe("busy")
    expect(await readFile(recallWakeLockPath(dir, 1), "utf8")).toBe(unprovableRecord)
    expect(await tickets(dir)).toEqual([])
  })

  test("#given a lease #when it is released twice #then the second release reports nothing to release", async () => {
    const dir = await locksDirectory()
    const slot = createKibitzerWakeSlot({ locksDirectory: dir, maxConcurrent: 2, waitTimeoutMs: 300, pollMs: 25 })
    const lease = acquired(await slot.acquire())
    expect(await lease.release()).toBe(true)
    expect(await lease.release()).toBe(false)
  })
})
