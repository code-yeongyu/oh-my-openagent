import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { acquireSessionAdmissionLease, type SessionAdmissionLease } from "./admission-lease"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

test("#given a contended lease #when the holder releases after the waiter is armed #then acquisition succeeds without the retry timer", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "admission-lease-wait-"))
  roots.push(stateDir)
  const held = await acquireSessionAdmissionLease(stateDir, "parent", { retryMs: 60_000, acquireTimeoutMs: 5_000 })
  if (held.kind !== "acquired") throw new Error("expected holder")
  const leases: SessionAdmissionLease[] = [held.lease]
  const pending = acquireSessionAdmissionLease(stateDir, "parent", { retryMs: 60_000, acquireTimeoutMs: 5_000 })
  try {
    await Promise.resolve()
    held.lease.release()
    const next = await pending
    if (next.kind !== "acquired") throw new Error("expected waiter to acquire")
    leases.push(next.lease)
    expect(next.lease.isOwner()).toBe(true)
    expect(held.lease.isOwner()).toBe(false)
  } finally {
    for (const lease of leases) lease.release()
  }
}, 5_000)
