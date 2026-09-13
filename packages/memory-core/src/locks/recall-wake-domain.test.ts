import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  RECALL_WAKE_DEFAULT_SLOTS,
  RecallWakeBusyError,
  acquireRecallWakeLease,
  recallWakeLockPath,
  recallWakeTicketDirectory,
  withRecallWakeLease,
  type RecallWakeLease,
} from "./index"
import { createLockRecord, type LockRecord } from "./lock-record"

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function fixture(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "recall-wake-"))
  dirs.push(dir)
  return dir
}

/** Rejects after `ms` so a wait for a signal that never comes fails with a name instead of hanging. */
function withinMs<T>(promise: Promise<T>, label: string, ms = 5_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms waiting for ${label}`)), ms)
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

/**
 * True when the promise has already settled. Both racers sit one microtask hop deep and the settled
 * branch is subscribed first, so an already-settled promise always beats the sentinel; a pending one
 * never does.
 */
async function settledAlready(promise: Promise<unknown>): Promise<boolean> {
  const sentinel = Symbol("pending")
  const winner = await Promise.race([promise.then(() => "settled", () => "settled"), Promise.resolve().then(() => sentinel)])
  return winner !== sentinel
}

async function tickets(dir: string): Promise<string[]> {
  return (await readdir(recallWakeTicketDirectory(dir))).filter((name) => name.endsWith(".ticket"))
}

async function writeRecord(filePath: string, record: LockRecord): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(record)}\n`)
}

/** Our own live identity: the strongest possible "live owner" a test can put in front of a contender. */
async function liveRecord(purpose: string): Promise<LockRecord> {
  const record = await createLockRecord(purpose)
  if (record.process_start === "unavailable") throw new Error("this host cannot prove process identity; the lock tests need it")
  return record
}

const fast = { waitTimeoutMs: 400, retryDelayMs: 10 }

describe("recall-wake lock domain: counting FIFO lease", () => {
  test("#given the default domain #when two leases are held #then the third contender is turned away busy after its bounded wait and its ticket is gone", async () => {
    const dir = await fixture()
    expect(RECALL_WAKE_DEFAULT_SLOTS).toBe(2)
    const first = await acquireRecallWakeLease(dir, fast)
    const second = await acquireRecallWakeLease(dir, fast)
    expect([first.slot, second.slot].sort()).toEqual([1, 2])

    const started = Date.now()
    const refused = acquireRecallWakeLease(dir, fast)
    await expect(refused).rejects.toBeInstanceOf(RecallWakeBusyError)
    // Busy is the deadline speaking, never an early return: the contender waited its whole budget.
    expect(Date.now() - started).toBeGreaterThanOrEqual(fast.waitTimeoutMs)
    expect(await tickets(dir)).toEqual([])
    // Both holders still own their slot records.
    expect(JSON.parse(await readFile(recallWakeLockPath(dir, 1), "utf8")).purpose).toBe("recall-wake")
    expect(JSON.parse(await readFile(recallWakeLockPath(dir, 2), "utf8")).purpose).toBe("recall-wake")

    expect(await first.release()).toBe(true)
    expect(await second.release()).toBe(true)
    // A configured count above the default opens more slots.
    const third = await acquireRecallWakeLease(dir, { ...fast, maxConcurrent: 3 })
    const fourth = await acquireRecallWakeLease(dir, { ...fast, maxConcurrent: 3 })
    const fifth = await acquireRecallWakeLease(dir, { ...fast, maxConcurrent: 3 })
    expect([third.slot, fourth.slot, fifth.slot].sort()).toEqual([1, 2, 3])
    await Promise.all([third.release(), fourth.release(), fifth.release()])
  })

  test("#given ten contenders and two slots #when slots are released one at a time #then every contender acquires, in ticket order, with never more than two leases live", async () => {
    const dir = await fixture()
    const order: number[] = []
    let live = 0
    let peak = 0
    const leases: Array<RecallWakeLease | undefined> = []
    const waits = Array.from({ length: 10 }, (_, index) =>
      acquireRecallWakeLease(dir, { waitTimeoutMs: 10_000, retryDelayMs: 10 }).then((lease) => {
        order.push(index)
        leases[index] = lease
        live += 1
        peak = Math.max(peak, live)
        return lease
      }),
    )

    await withinMs(Promise.all([waits[0], waits[1]]), "the first two leases")
    expect(order).toEqual([0, 1])
    expect(await settledAlready(waits[2] ?? Promise.resolve())).toBe(false)

    // Each release admits exactly the next ticket, never a later one.
    for (let next = 2; next < 10; next += 1) {
      const releasing = leases[next - 2]
      if (releasing === undefined) throw new Error(`lease ${next - 2} was never acquired`)
      live -= 1
      expect(await releasing.release()).toBe(true)
      await withinMs(waits[next] ?? Promise.resolve(), `lease ${next}`)
      expect(order[next]).toBe(next)
      if (next + 1 < 10) expect(await settledAlready(waits[next + 1] ?? Promise.resolve())).toBe(false)
    }

    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(peak).toBe(2)
    expect(await tickets(dir)).toEqual([])
    for (const lease of leases.slice(8)) expect(await lease?.release()).toBe(true)
  })

  test("#given a dead owner recorded on both slots #when a contender arrives #then both are reclaimed on the liveness proof and the new owner is recorded", async () => {
    const dir = await fixture()
    const stale = await createLockRecord("recall-wake")
    const dead: LockRecord = { ...stale, pid: 99_999_999, process_start: "proc-start-epoch:0" }
    await writeRecord(recallWakeLockPath(dir, 1), dead)
    await writeRecord(recallWakeLockPath(dir, 2), { ...dead, nonce: `${dead.nonce}-2` })

    const first = await acquireRecallWakeLease(dir, fast)
    const second = await acquireRecallWakeLease(dir, fast)

    expect([first.slot, second.slot].sort()).toEqual([1, 2])
    for (const slot of [1, 2]) {
      const owner = JSON.parse(await readFile(recallWakeLockPath(dir, slot), "utf8")) as LockRecord
      expect(owner.pid).toBe(process.pid)
      expect(owner.purpose).toBe("recall-wake")
    }
    await Promise.all([first.release(), second.release()])
  })

  test("#given a live owner on every slot #when a contender waits its budget #then no record is touched: a live owner is never stolen", async () => {
    const dir = await fixture()
    const owner = await liveRecord("recall-wake")
    const before = [`${JSON.stringify(owner)}\n`, `${JSON.stringify({ ...owner, nonce: `${owner.nonce}-2` })}\n`]
    await writeFile(recallWakeLockPath(dir, 1), before[0] ?? "")
    await writeFile(recallWakeLockPath(dir, 2), before[1] ?? "")

    await expect(acquireRecallWakeLease(dir, fast)).rejects.toBeInstanceOf(RecallWakeBusyError)

    expect(await readFile(recallWakeLockPath(dir, 1), "utf8")).toBe(before[0])
    expect(await readFile(recallWakeLockPath(dir, 2), "utf8")).toBe(before[1])
    expect(await tickets(dir)).toEqual([])
  })

  test("#given a live pid whose recorded start identity conflicts #when a contender arrives #then the reused pid is reclaimed, while an unprovable identity keeps its slot", async () => {
    const dir = await fixture()
    const own = await liveRecord("recall-wake")
    // Same pid, same identity scheme, different value: the pid was recycled, so the owner is proven dead.
    const recycled: LockRecord = { ...own, process_start: `${own.process_start}-recycled` }
    // Same pid but no comparable identity: liveness says alive and nothing can prove otherwise.
    const unprovable: LockRecord = { ...own, nonce: `${own.nonce}-unprovable`, process_start: "unavailable" }
    await writeRecord(recallWakeLockPath(dir, 1), recycled)
    await writeRecord(recallWakeLockPath(dir, 2), unprovable)

    const lease = await acquireRecallWakeLease(dir, fast)
    expect(lease.slot).toBe(1)
    expect((JSON.parse(await readFile(recallWakeLockPath(dir, 1), "utf8")) as LockRecord).nonce).not.toBe(recycled.nonce)
    expect(await readFile(recallWakeLockPath(dir, 2), "utf8")).toBe(`${JSON.stringify(unprovable)}\n`)

    await expect(acquireRecallWakeLease(dir, fast)).rejects.toBeInstanceOf(RecallWakeBusyError)
    expect(await lease.release()).toBe(true)
  })

  test("#given a dead owner's ticket at the head of the queue #when a contender arrives #then the dead ticket is reaped and the contender proceeds; a live owner's ticket ahead is honoured", async () => {
    const dir = await fixture()
    const ticketDir = recallWakeTicketDirectory(dir)
    await mkdir(ticketDir, { recursive: true })
    const stale = await createLockRecord("recall-wake:ticket")
    await writeRecord(path.join(ticketDir, "0000000000000000-000000-0000000000-dead.ticket"), { ...stale, pid: 99_999_999, process_start: "proc-start-epoch:0" })

    const lease = await acquireRecallWakeLease(dir, fast)
    expect(lease.slot).toBe(1)
    expect(await tickets(dir)).toEqual([])
    expect(await lease.release()).toBe(true)

    // A live process's ticket ahead of us is a real queue position: we wait behind it and leave busy.
    const live = await liveRecord("recall-wake:ticket")
    const liveTicket = path.join(ticketDir, "0000000000000000-000000-0000000000-live.ticket")
    await writeRecord(liveTicket, live)
    await expect(acquireRecallWakeLease(dir, fast)).rejects.toBeInstanceOf(RecallWakeBusyError)
    expect(await tickets(dir)).toEqual([path.basename(liveTicket)])
  })

  test("#given a waiting contender #when its signal aborts #then the wait ends promptly with the abort reason and no ticket is left behind", async () => {
    const dir = await fixture()
    const first = await acquireRecallWakeLease(dir, fast)
    const second = await acquireRecallWakeLease(dir, fast)
    const controller = new AbortController()
    const waiting = acquireRecallWakeLease(dir, { waitTimeoutMs: 60_000, retryDelayMs: 10, signal: controller.signal })
    // The abort lands while the contender is parked between polls.
    controller.abort(new Error("session shutdown"))

    await expect(withinMs(waiting, "the aborted wait")).rejects.toThrow("session shutdown")
    expect(await tickets(dir)).toEqual([])
    await Promise.all([first.release(), second.release()])
  })

  test("#given a callback #when it completes or throws #then the slot is released either way", async () => {
    const dir = await fixture()
    const slot = await withRecallWakeLease(dir, async (lease) => lease.slot, fast)
    expect(slot).toBe(1)
    await expect(withRecallWakeLease(dir, async () => {
      throw new Error("wake failed")
    }, fast)).rejects.toThrow("wake failed")
    const again = await acquireRecallWakeLease(dir, { ...fast, maxConcurrent: 1 })
    expect(again.slot).toBe(1)
    expect(await again.release()).toBe(true)
  })

  test("#given a lock path builder #when slots are numbered #then each slot has its own file under the locks directory on every platform", () => {
    expect(recallWakeLockPath("/locks", 1)).toBe(path.join("/locks", "recall-wake.slot-1.lock"))
    expect(recallWakeLockPath("/locks", 2)).toBe(path.join("/locks", "recall-wake.slot-2.lock"))
    expect(recallWakeTicketDirectory("/locks")).toBe(path.join("/locks", "recall-wake.tickets"))
    expect(() => recallWakeLockPath("/locks", 0)).toThrow()
  })
})
