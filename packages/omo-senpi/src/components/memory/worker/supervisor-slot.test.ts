import { expect, test } from "bun:test"
import { slotHarness } from "./supervisor-slot.test-support"
import { readRunJson, type RunLaunchManifest } from "./run-artifacts"
import { join } from "node:path"
import { advanceTestClock } from "./supervisor-test-signals"
import type { ReservationRunLedger } from "./reservation-run-ledger"
import { createLockRecord, LockContentionError, withLock } from "@oh-my-opencode/memory-core"

test("five simultaneous identities obey the machine cap and all publish outcomes", async () => {
  const harness = await slotHarness()
  try {
    const runs = await Promise.all(Array.from({ length: 5 }, (_, index) => harness.makeRun(`identity-${index}`)))
    const accounted = harness.waitAccounted(5)
    const launched = runs.map((run) => harness.launch(run))
    await accounted
    harness.flow()
    const exits = await Promise.all(launched.map(({ exit }) => exit))
    const outcomes = await Promise.all(runs.map(({ runDir }) => harness.outcome(runDir)))
    console.log(`REFLECTION_CAP peak=${harness.peak()} cap=1 completed=${outcomes.length} exits=${exits.join(",")}`)
    expect(exits).toEqual([0, 0, 0, 0, 0])
    expect(outcomes.every((outcome) => outcome.childExit.code === 0 && !outcome.timedOut)).toBe(true)
    expect(harness.peak()).toBeLessThanOrEqual(1)
  } finally {
    await harness.cleanup()
  }
}, 60_000)

test("a surviving bootstrap retains its slot after the supervisor is killed", async () => {
  const harness = await slotHarness()
  try {
    const first = await harness.makeRun("survivor")
    const started = harness.waitStarted(first.id)
    const supervisor = harness.launch(first)
    await started
    supervisor.child.kill("SIGKILL")
    await supervisor.exit
    const contender = await createLockRecord("reflection-run")
    const result = await withLock(join(harness.locks, "reflection-run.slot-1.lock"), contender,
      async () => "unexpected admission", { waitTimeoutMs: 0 }).catch((error: unknown) => error)
    expect(result).toBeInstanceOf(LockContentionError)
    const second = await harness.makeRun("successor")
    const queued = harness.waitQueued(1)
    const successor = harness.launch(second)
    await queued
    const nextStarted = harness.waitStarted(second.id)
    harness.release(first.id)
    await nextStarted
    harness.release(second.id)
    expect(await successor.exit).toBe(0)
    expect(harness.peak()).toBe(1)
  } finally {
    await harness.cleanup()
  }
}, 60_000)

test("a configured cap of two admits two children across identities", async () => {
  const harness = await slotHarness()
  try {
    const runs = await Promise.all(Array.from({ length: 5 }, (_, index) => harness.makeRun(`pair-${index}`, 2)))
    const accounted = harness.waitAccounted(5, 2)
    const launched = runs.map((run) => harness.launch(run))
    await accounted
    harness.flow()
    expect(await Promise.all(launched.map(({ exit }) => exit))).toEqual([0, 0, 0, 0, 0])
    expect(harness.peak()).toBe(2)
    expect((await Promise.all(runs.map(({ runDir }) => harness.outcome(runDir))))
      .every((outcome) => outcome.childExit.code === 0 && !outcome.timedOut)).toBe(true)
  } finally {
    await harness.cleanup()
  }
}, 60_000)

test.each(["SIGTERM", "SIGKILL"] as const)("a queued supervisor killed with %s cannot block its FIFO successor", async (signal) => {
  const harness = await slotHarness()
  try {
    const runs = await Promise.all(["first", "killed", "third"].map((id) => harness.makeRun(id)))
    const [first, killed, third] = runs
    if (first === undefined || killed === undefined || third === undefined) throw new Error("missing runs")
    const started = harness.waitStarted(first.id)
    const firstChild = harness.launch(first)
    await started
    const queued = harness.waitQueued(1)
    const killedChild = harness.launch(killed)
    await queued
    const bothQueued = harness.waitQueued(2)
    const thirdChild = harness.launch(third)
    await bothQueued
    killedChild.child.kill(signal)
    await killedChild.exit
    const successor = harness.waitStarted(third.id)
    harness.release(first.id)
    await successor
    harness.release(third.id)
    expect(await Promise.all([firstChild.exit, thirdChild.exit])).toEqual([0, 0])
    expect(harness.order).toEqual(["first", "third"])
    expect(harness.peak()).toBe(1)
    await harness.waitQueued(0)
  } finally {
    await harness.cleanup()
  }
}, 60_000)

test("waiting beyond the original budget rebases both durable deadlines before the child starts", async () => {
  const harness = await slotHarness()
  try {
    const now = Date.now()
    const first = await harness.makeRun("holder", 1, now)
    const second = await harness.makeRun("waiter", 1, now)
    if (second.clockPath === undefined) throw new Error("missing clock")
    const started = harness.waitStarted(first.id)
    const firstChild = harness.launch(first)
    await started
    const queued = harness.waitQueued(1)
    const secondChild = harness.launch(second)
    await queued
    await advanceTestClock(second.clockPath, now + 20_000)
    const admitted = harness.waitStarted(second.id)
    harness.release(first.id)
    await admitted
    const manifest = await readRunJson<RunLaunchManifest>(join(second.runDir, "launch.json"))
    const ledger = await readRunJson<ReservationRunLedger>(join(second.runDir, "ledger.json"))
    expect(manifest.hardDeadlineAt).toBe(now + 30_000)
    expect(ledger.hardDeadlineAt).toBe(manifest.hardDeadlineAt)
    expect(ledger.deadlineAt).toBe(now + 31_000)
    expect(ledger.queued).toBe(false)
    expect(ledger.startedAt).toBe(second.ledger.startedAt)
    await advanceTestClock(second.clockPath, now + 29_999)
    harness.release(second.id)
    expect(await Promise.all([firstChild.exit, secondChild.exit])).toEqual([0, 0])
    expect(await harness.outcome(second.runDir)).toMatchObject({ childExit: { code: 0 }, timedOut: false })
    console.log("REFLECTION_DEADLINE queued=20000 budget=10000 remaining=10000 completed=2")
  } finally {
    await harness.cleanup()
  }
}, 60_000)
