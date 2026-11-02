import { expect, test } from "bun:test"
import { slotHarness } from "./supervisor-slot.test-support"
import { readRunJson, writeRunJsonAtomic, type RunLaunchManifest } from "./run-artifacts"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { advanceTestClock } from "./supervisor-test-signals"
import type { ReservationRunLedger } from "./reservation-run-ledger"
import { createLockRecord, LockContentionError, withLock } from "@oh-my-opencode/memory-core"

const TEST_TIMEOUT_MS = 60_000

test("#given a supervisor exits before TCP start #then the start wait reports its exit and artifacts", async () => {
  const harness = await slotHarness(3_000)
  try {
    const run = await harness.makeRun("exits-before-start")
    await writeRunJsonAtomic(join(run.runDir, "launch.json"), {
      ...run.manifest,
      args: ["-e", 'process.stderr.write("fixture child failed\\n"); process.exit(23)'],
    })
    const started = harness.waitStarted(run.id)
    // Observe failure before launching; the assertion still consumes the original promise.
    void started.catch(() => undefined)
    const supervisor = harness.launch(run)
    expect(await supervisor.exit).toBe(0)
    await expect(started).rejects.toThrow("supervisor exits-before-start exited")
    await expect(started).rejects.toThrow("code=0")
    await expect(started).rejects.toThrow("supervisor stderr:")
    await expect(started).rejects.toThrow('"code": 23')
    await expect(started).rejects.toThrow("fixture child failed")
    await expect(harness.waitStarted(run.id)).rejects.toThrow("supervisor exits-before-start exited")
    expect(await harness.outcome(run.runDir)).toMatchObject({ childExit: { code: 23 } })
    expect(harness.order).toEqual([])
  } finally {
    await harness.cleanup()
  }
}, TEST_TIMEOUT_MS)

test("#given Windows admission rename contention exceeds its retry budget #then every active wait reports the supervisor exit", async () => {
  const harness = await slotHarness(TEST_TIMEOUT_MS)
  try {
    const run = await harness.makeRun("admission-contention")
    const waiting = [
      harness.waitStarted(run.id),
      harness.waitAccounted(2),
      harness.waitQueued(2),
      harness.outcome(run.runDir),
    ]
    const results = Promise.allSettled(waiting)
    const supervisor = harness.launch(run, fileURLToPath(new URL("./__fixtures__/supervisor-admission-contention.ts", import.meta.url)))
    expect(await supervisor.exit).toBe(1)
    for (const result of await results) {
      expect(result.status).toBe("rejected")
      if (result.status !== "rejected") throw new Error("wait ignored supervisor exit")
      const message = String(result.reason)
      expect(message).toContain("supervisor admission-contention exited code=1")
      expect(message).toContain("EPERM: admission rename held; attempts=7 elapsed=785ms")
      expect(message).toContain("outcome.json:\n<missing>")
      expect(message).toContain("stderr.log):\n<missing>")
    }
    expect(harness.order).toEqual([])
    console.log("ADMISSION_CONTENTION attempts=7 elapsed=785ms supervisorExit=1 childStarted=false waitsRejected=4")
  } finally {
    await harness.cleanup()
  }
}, TEST_TIMEOUT_MS)

test("five simultaneous identities obey the machine cap and all publish outcomes", async () => {
  const harness = await slotHarness(TEST_TIMEOUT_MS)
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
}, TEST_TIMEOUT_MS)

test("a surviving bootstrap retains its slot after the supervisor is killed", async () => {
  const harness = await slotHarness(TEST_TIMEOUT_MS)
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
}, TEST_TIMEOUT_MS)

test("a configured cap of two admits two children across identities", async () => {
  const harness = await slotHarness(TEST_TIMEOUT_MS)
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
}, TEST_TIMEOUT_MS)

test.each(["SIGTERM", "SIGKILL"] as const)("a queued supervisor killed with %s cannot block its FIFO successor", async (signal) => {
  const harness = await slotHarness(TEST_TIMEOUT_MS)
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
}, TEST_TIMEOUT_MS)

test("waiting beyond the original budget rebases both durable deadlines before the child starts", async () => {
  const harness = await slotHarness(TEST_TIMEOUT_MS)
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
}, TEST_TIMEOUT_MS)
