import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { acquireSessionAdmissionLease, admissionLeasePath, type SessionAdmissionLease } from "./admission-lease"

test("#given local admission waiters #when the holder releases #then ownership hands off before runner continuations without a retry timer", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "senpi-task-admission-handoff-"))
  const held = await acquireSessionAdmissionLease(stateDir, "parent")
  if (held.kind !== "acquired") throw new Error("expected initial admission lease")
  const order: number[] = []
  const leases: SessionAdmissionLease[] = [held.lease]
  const wait = (id: number) => acquireSessionAdmissionLease(stateDir, "parent").then(result => {
    if (result.kind !== "acquired") throw new Error("expected queued admission lease")
    leases.push(result.lease)
    order.push(id)
    return result.lease
  })
  // Subscribe both callers before release, just as parallel DAG starts contend on one parent.
  const second = wait(2)
  const third = wait(3)
  try {
    held.lease.release()
    // This continuation models runner start/completion work queued by the releasing caller.
    await Promise.resolve()
    expect(order).toEqual([2])
    const next = await second
    expect(next.isOwner()).toBe(true)
    expect(held.lease.isOwner()).toBe(false)
    next.release()
    await Promise.resolve()
    expect(order).toEqual([2, 3])
    const last = await third
    expect(last.isOwner()).toBe(true)
    last.release()
    expect(existsSync(admissionLeasePath(stateDir, "parent"))).toBe(false)
  } finally {
    // Drain outstanding acquisition promises even on RED, without leaving timers or leases.
    held.lease.release()
    const next = await second
    next.release()
    const last = await third
    last.release()
    for (const lease of leases) lease.release()
    rmSync(stateDir, { recursive: true, force: true })
  }
}, 5_000)
