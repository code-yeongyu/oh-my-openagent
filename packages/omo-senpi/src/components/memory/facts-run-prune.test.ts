import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { factsRunsLockPath, runFinalizationLockPath } from "@oh-my-opencode/memory-core"

import { sweepTerminalFactsRuns } from "./facts-run-cleanup"
import { pruneTerminalFactsRuns } from "./facts-run-prune"
import { reserveFactsRunDir } from "./facts-run-storage"
import {
  ENTRIES,
  digestOf,
  finalizeReserved,
  fixture,
  holdLock,
  instant,
  reserveRun,
  runName,
  runNames,
  seedNonTerminalRun,
  seedTerminalRun,
} from "./facts-run-prune.test-support"
import { writeRunJsonAtomic } from "./worker/run-artifacts"

describe("terminal facts run pruning", () => {
  test("#given 25 terminal runs #when pruning keeps the last 20 #then the newest 20 survive deterministically", async () => {
    // #given
    const { factsDir, locksDir } = await fixture()
    for (let index = 0; index < 25; index += 1) {
      await seedTerminalRun({ factsDir, runId: `facts-aaaa-${index}`, finishedAt: instant(index) })
    }

    // #when
    const result = await pruneTerminalFactsRuns({ factsDir, locksDir })

    // #then
    const remaining = await runNames(factsDir)
    expect(remaining).toHaveLength(20)
    expect([...result.pruned].sort()).toEqual(
      Array.from({ length: 5 }, (_, index) => `facts-aaaa-${index}`).sort(),
    )
    expect(remaining).toContain("facts-aaaa-24")
    expect(remaining).not.toContain("facts-aaaa-4")
  }, 30_000)

  test("#given the newest run alone exceeds the byte cap #when pruning runs #then the newest is still kept", async () => {
    // #given: the cap alone would delete everything; the newest-always-kept rule overrides it.
    const { factsDir, locksDir } = await fixture()
    await seedTerminalRun({ factsDir, runId: "facts-bbbb-1", finishedAt: instant(1), bytes: 4_096 })
    await seedTerminalRun({ factsDir, runId: "facts-bbbb-2", finishedAt: instant(2), bytes: 8_192 })

    // #when
    const result = await pruneTerminalFactsRuns({ factsDir, locksDir, maxTotalBytes: 1_024 })

    // #then
    expect(await runNames(factsDir)).toEqual(["facts-bbbb-2"])
    expect(result.pruned).toEqual(["facts-bbbb-1"])
  }, 30_000)

  test("#given terminal runs past the byte cap #when pruning runs #then only the newest-first prefix under the cap survives", async () => {
    // #given
    const { factsDir, locksDir } = await fixture()
    for (let index = 1; index <= 4; index += 1) {
      await seedTerminalRun({ factsDir, runId: `facts-cccc-${index}`, finishedAt: instant(index), bytes: 100_000 })
    }

    // #when: two runs' filler fits under the cap, the third pushes past it.
    // Filler is large enough that platform-specific directory metadata (lstat
    // on a directory is 4096 on ext4 vs 64 on APFS) does not tip the cap.
    await pruneTerminalFactsRuns({ factsDir, locksDir, maxTotalBytes: 250_000 })

    // #then
    expect(await runNames(factsDir)).toEqual(["facts-cccc-3", "facts-cccc-4"])
  }, 30_000)

  test("#given runs finishing in the same instant #when pruning sorts them #then the run id breaks the tie deterministically", async () => {
    // #given
    const { factsDir, locksDir } = await fixture()
    await seedTerminalRun({ factsDir, runId: "facts-dddd-1", finishedAt: instant(5) })
    await seedTerminalRun({ factsDir, runId: "facts-dddd-2", finishedAt: instant(5) })
    await seedTerminalRun({ factsDir, runId: "facts-dddd-3", finishedAt: instant(5) })

    // #when
    await pruneTerminalFactsRuns({ factsDir, locksDir, keepLast: 1 })

    // #then: the highest run id wins the tie and is the newest.
    expect(await runNames(factsDir)).toEqual(["facts-dddd-3"])
  }, 30_000)

  test("#given a non-terminal run dir #when pruning runs #then it is never pruned", async () => {
    // #given
    const { factsDir, locksDir } = await fixture()
    await seedNonTerminalRun(factsDir, "facts-live-1")
    await seedTerminalRun({ factsDir, runId: "facts-eeee-1", finishedAt: instant(1) })
    await seedTerminalRun({ factsDir, runId: "facts-eeee-2", finishedAt: instant(2) })

    // #when
    const result = await pruneTerminalFactsRuns({ factsDir, locksDir, keepLast: 1 })

    // #then
    expect(await runNames(factsDir)).toEqual(["facts-eeee-2", "facts-live-1"])
    expect(result.pruned).toEqual(["facts-eeee-1"])
  }, 30_000)

  test("#given a malformed sentinel #when pruning runs #then the mismatched run is never pruned", async () => {
    // #given: sentinel runId disagrees with the dir name, so the record cannot be trusted.
    const { factsDir, locksDir } = await fixture()
    await seedTerminalRun({
      factsDir,
      runId: "facts-ffff-1",
      finishedAt: instant(1),
      sentinelRunId: "facts-somewhere-else",
    })
    await seedTerminalRun({ factsDir, runId: "facts-ffff-2", finishedAt: instant(2) })
    await mkdir(join(factsDir, "runs", "facts-ffff-3"), { recursive: true })
    await writeFile(join(factsDir, "runs", "facts-ffff-3", "final.json"), "{ not json", "utf8")

    // #when
    const result = await pruneTerminalFactsRuns({ factsDir, locksDir, keepLast: 1 })

    // #then
    expect(result.pruned).toEqual([])
    expect(await runNames(factsDir)).toEqual(["facts-ffff-1", "facts-ffff-2", "facts-ffff-3"])
  }, 30_000)

  test("#given a live process holding a run's finalize lock #when pruning runs #then that run survives", async () => {
    // #given: a real child process owns finalize-<runId>.lock, so the lock cannot be recovered.
    const { factsDir, locksDir } = await fixture()
    await seedTerminalRun({ factsDir, runId: "facts-gggg-1", finishedAt: instant(1) })
    await seedTerminalRun({ factsDir, runId: "facts-gggg-2", finishedAt: instant(2) })
    await seedTerminalRun({ factsDir, runId: "facts-gggg-3", finishedAt: instant(3) })
    await holdLock(runFinalizationLockPath(locksDir, "facts-gggg-1"))

    // #when
    const result = await pruneTerminalFactsRuns({ factsDir, locksDir, keepLast: 1 })

    // #then
    expect(result.pruned).toEqual(["facts-gggg-2"])
    expect(await runNames(factsDir)).toEqual(["facts-gggg-1", "facts-gggg-3"])
  }, 30_000)

  test("#given a leftover prune tombstone #when session-start maintenance sweeps #then the tombstone is removed", async () => {
    // #given: a crash between the tombstone rename and its deletion.
    const { factsDir } = await fixture()
    const tombstone = join(factsDir, "runs", ".prune-facts-hhhh-1-11111111-1111-4111-8111-111111111111")
    await mkdir(tombstone, { recursive: true })
    await writeFile(join(tombstone, "facts-payload.json"), "{}\n", "utf8")
    await seedTerminalRun({ factsDir, runId: "facts-hhhh-2", finishedAt: instant(2) })

    // #when
    await sweepTerminalFactsRuns({ factsDir })

    // #then
    expect(existsSync(tombstone)).toBe(false)
    expect(await runNames(factsDir)).toEqual(["facts-hhhh-2"])
  }, 30_000)

  test("#given pruning frees a lower attempt name #when a higher attempt survives #then the sequence stays monotonic", async () => {
    // #given: two attempts of one digest, both terminal.
    const { factsDir, locksDir } = await fixture()
    const first = await reserveRun(factsDir, locksDir, instant(1))
    await finalizeReserved(first, instant(1))
    const second = await reserveRun(factsDir, locksDir, instant(2))
    await finalizeReserved(second, instant(2))
    expect([runName(first), runName(second)]).toEqual(["facts-" + digestOf(first) + "-1", "facts-" + digestOf(first) + "-2"])

    // #when: pruning removes attempt 1, then the same digest reserves again.
    const result = await pruneTerminalFactsRuns({ factsDir, locksDir, keepLast: 1 })
    const third = await reserveRun(factsDir, locksDir, instant(3))

    // #then: the freed name is not handed back while a higher attempt is still on disk.
    expect(result.pruned).toEqual([runName(first)])
    expect(runName(third)).toBe("facts-" + digestOf(first) + "-3")
    expect(await runNames(factsDir)).toEqual([runName(second), runName(third)])
  }, 30_000)

  test("#given every trace of a digest is pruned #when it reserves again #then the attempt name IS reused", async () => {
    // #given: the high-water mark lives on disk, so evicting the last trace restarts the count.
    // This is deliberate: failure-streak identity keys on the ledger's per-launch batchId, not on
    // the run name, so a reused name cannot be mistaken for the pruned run's failure.
    const { factsDir, locksDir } = await fixture()
    const first = await reserveRun(factsDir, locksDir, instant(1))
    await finalizeReserved(first, instant(1))
    await seedTerminalRun({ factsDir, runId: "facts-newer-1", finishedAt: instant(5) })

    // #when: retention keeps only the newer foreign run, erasing this digest's last trace.
    const result = await pruneTerminalFactsRuns({ factsDir, locksDir, keepLast: 1 })
    const retry = await reserveRun(factsDir, locksDir, instant(6))

    // #then
    expect(result.pruned).toEqual([runName(first)])
    expect(runName(retry)).toBe(runName(first))
  }, 30_000)

  test("#given the facts-runs lock held by a live process #when a reservation runs #then it waits rather than racing the scan", async () => {
    // #given
    const { factsDir, locksDir } = await fixture()
    await holdLock(factsRunsLockPath(locksDir))

    // #when
    const reservation = reserveFactsRunDir({
      factsDir,
      locksDir,
      entries: ENTRIES,
      batchId: "11111111-1111-4111-8111-111111111111",
      launchedAt: Date.parse(instant(1)),
      lockWaitMs: 50,
    })

    // #then
    await expect(reservation).rejects.toThrow(/Lock is held/)
    expect(await runNames(factsDir)).toEqual([])
  }, 30_000)

  test("#given a tombstone rename #when the deletion runs #then the facts-runs lock is already released", async () => {
    // #given: rm -rf must never happen under the shared runs lock.
    const { factsDir, locksDir } = await fixture()
    await seedTerminalRun({ factsDir, runId: "facts-iiii-1", finishedAt: instant(1) })
    await seedTerminalRun({ factsDir, runId: "facts-iiii-2", finishedAt: instant(2) })
    const heldDuringDelete: boolean[] = []

    // #when
    await pruneTerminalFactsRuns({
      factsDir,
      locksDir,
      keepLast: 1,
      beforeTombstoneDelete: () => {
        heldDuringDelete.push(existsSync(factsRunsLockPath(locksDir)))
      },
    })

    // #then
    expect(heldDuringDelete).toEqual([false])
    expect(await runNames(factsDir)).toEqual(["facts-iiii-2"])
  }, 30_000)
})
