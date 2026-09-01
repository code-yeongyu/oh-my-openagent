import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { FactsExtractorRunner } from "./facts-runner"
import { fixture, onlyRunDir, runnerOptions } from "./facts-runner.test-support"
import { writeRunJsonAtomic } from "./worker/run-artifacts"

const ABANDONED_RUN_ID = "facts-abandoned-1"
const TERMINAL_RUN_ID = "facts-terminal-1"
const LATER = new Date("2026-08-11T12:00:00.000Z")

/** Reconcile-only drive: reconcile the run dirs, then refuse the follow-on launch. */
function reconcileOnly(runner: FactsExtractorRunner) {
  const stop = new AbortController()
  stop.abort()
  return runner.reconcilePending(stop.signal)
}

function payloadPath(runDir: string): string {
  return join(runDir, "facts-payload.json")
}

async function seedRunDir(factsDir: string, runId: string, extra: Readonly<Record<string, unknown>>) {
  const runDir = join(factsDir, "runs", runId)
  await mkdir(runDir, { recursive: true })
  await writeRunJsonAtomic(join(runDir, "ledger.json"), {
    version: 1,
    runId,
    kind: "facts",
    startedAt: "2026-08-10T12:00:00.000Z",
    hardDeadlineAt: Date.parse("2026-08-10T12:01:00.000Z"),
    terminationGraceMs: 100,
    deadlineAt: Date.parse("2026-08-10T12:01:00.100Z"),
    batchId: "11111111-1111-4111-8111-111111111111",
    queued: [{ conversationId: "session-1", end_message_id: "m1", end_snapshot_line: 1 }],
    ...extra,
  })
  await writeFile(payloadPath(runDir), "{}\n", "utf8")
  return runDir
}

/**
 * Deletion seam that records, per removed path, whether a terminal sentinel already existed.
 * Structural ordering proof: a payload deleted before the sentinel would record `false`.
 */
function deletionProbe(remove: (path: string) => Promise<void>) {
  const observed: { readonly path: string; readonly sentinelExisted: boolean }[] = []
  return {
    observed,
    remove: async (path: string): Promise<void> => {
      const runDir = join(path, "..")
      observed.push({
        path: path.split(/[\\/]/).pop() ?? "",
        sentinelExisted: existsSync(join(runDir, "final.json")) || existsSync(join(runDir, "abandoned.json")),
      })
      await remove(path)
    },
  }
}

function warnCollector() {
  const warnings: { readonly message: string; readonly fields: unknown }[] = []
  return {
    warnings,
    logger: {
      info: () => undefined,
      warn: (message: string, fields?: unknown) => warnings.push({ message, fields }),
      error: () => undefined,
    },
  }
}

async function expectCleanTerminalRun(runDir: string, sentinel: "final.json" | "abandoned.json"): Promise<void> {
  expect(existsSync(join(runDir, sentinel))).toBe(true)
  expect(existsSync(payloadPath(runDir))).toBe(false)
  expect(existsSync(join(runDir, ".sandbox-tmp"))).toBe(false)
  expect(existsSync(join(runDir, "ledger.json"))).toBe(true)
}

describe("facts terminal payload deletion", () => {
  test("#given a committed run #when it finalizes #then the payload is gone and the sentinel remains", async () => {
    // given
    const { root, identity, queue } = await fixture()
    const runner = new FactsExtractorRunner(runnerOptions(root, identity, queue, "fact"))

    // when
    const result = await runner.launchPending()

    // then
    expect(result.status).toBe("committed")
    await expectCleanTerminalRun(await onlyRunDir(identity), "final.json")
  }, 30_000)

  test("#given an extraction with no facts #when it finalizes #then the payload is deleted too", async () => {
    // given
    const { root, identity, queue } = await fixture()
    const runner = new FactsExtractorRunner(runnerOptions(root, identity, queue, "empty"))

    // when
    const result = await runner.launchPending()

    // then
    expect(result.status).toBe("no_facts")
    await expectCleanTerminalRun(await onlyRunDir(identity), "final.json")
  }, 30_000)

  test("#given a failing child #when the run finalizes #then the payload is deleted too", async () => {
    // given
    const { root, identity, queue } = await fixture()
    const runner = new FactsExtractorRunner(runnerOptions(root, identity, queue, "fail"))

    // when
    const result = await runner.launchPending()

    // then
    expect(result.status).toBe("failed")
    await expectCleanTerminalRun(await onlyRunDir(identity), "final.json")
  }, 30_000)

  test("#given a dirty parent repo #when the run finalizes parent_dirty #then the payload is deleted too", async () => {
    // given
    const { root, identity, queue } = await fixture()
    let dirty = true
    const runner = new FactsExtractorRunner(runnerOptions(root, identity, queue, "fact", {
      withWriterLock: async (operation) => {
        if (dirty) {
          dirty = false
          await writeFile(join(identity.paths.repo, "foreign.md"), "parent bytes\n")
        }
        return operation()
      },
    }))

    // when
    const result = await runner.launchPending()

    // then
    expect(result.status).toBe("parent_dirty")
    await expectCleanTerminalRun(await onlyRunDir(identity), "final.json")
  }, 30_000)

  test("#given a run of unknown liveness #when reconcile abandons it #then the payload is deleted after the sentinel", async () => {
    // given
    const { root, identity, queue } = await fixture()
    const runDir = await seedRunDir(identity.paths.facts, ABANDONED_RUN_ID, {})

    // when
    await reconcileOnly(new FactsExtractorRunner(runnerOptions(root, identity, queue, "fail", { now: () => LATER })))

    // then
    await expectCleanTerminalRun(runDir, "abandoned.json")
  }, 30_000)

  test("#given a finalizing run #when the payload is deleted #then a terminal sentinel already exists", async () => {
    // given: the ordering contract - the payload is reconciliation's rebuild input, so it may
    // only disappear once the run is durably terminal.
    const { root, identity, queue } = await fixture()
    const probe = deletionProbe(async (path) => {
      await Bun.file(path).delete()
    })
    const runner = new FactsExtractorRunner(runnerOptions(root, identity, queue, "fact", {
      removeRunArtifact: probe.remove,
    }))

    // when
    const result = await runner.launchPending()

    // then
    expect(result.status).toBe("committed")
    expect(probe.observed.map((entry) => entry.path)).toContain("facts-payload.json")
    expect(probe.observed.every((entry) => entry.sentinelExisted)).toBe(true)
  }, 30_000)

  test("#given a crash after the sentinel #when the next session reconciles #then maintenance removes the leftover payload", async () => {
    // given: sentinel written, payload survived - exactly the crash window deletion-after leaves.
    const { root, identity, queue } = await fixture()
    const runDir = await seedRunDir(identity.paths.facts, TERMINAL_RUN_ID, {})
    await writeRunJsonAtomic(join(runDir, "final.json"), {
      version: 1,
      runId: TERMINAL_RUN_ID,
      outcome: "committed",
      finishedAt: "2026-08-10T12:02:00.000Z",
      sha: "deadbeef",
    })
    await mkdir(join(runDir, ".sandbox-tmp"), { recursive: true })

    // when
    await reconcileOnly(new FactsExtractorRunner(runnerOptions(root, identity, queue, "fail", { now: () => LATER })))

    // then
    await expectCleanTerminalRun(runDir, "final.json")
  }, 30_000)

  test("#given a non-terminal run dir #when maintenance sweeps #then its payload is left untouched", async () => {
    // given: no sentinel and still inside its deadline - reconciliation must keep its inputs.
    const { root, identity, queue } = await fixture()
    const runDir = await seedRunDir(identity.paths.facts, "facts-live-1", {
      deadlineAt: Date.parse("2026-08-20T12:00:00.000Z"),
      hardDeadlineAt: Date.parse("2026-08-20T12:00:00.000Z"),
    })

    // when
    const result = await reconcileOnly(new FactsExtractorRunner(
      runnerOptions(root, identity, queue, "fail", { now: () => LATER }),
    ))

    // then
    expect(result.status).toBe("active")
    expect(existsSync(payloadPath(runDir))).toBe(true)
  }, 30_000)

  test("#given an unlink that fails #when the run finalizes #then the outcome stands and a warning is logged", async () => {
    // given
    const { root, identity, queue } = await fixture()
    const collector = warnCollector()
    const runner = new FactsExtractorRunner(runnerOptions(root, identity, queue, "fact", {
      logger: collector.logger,
      removeRunArtifact: async (path: string) => {
        throw new Error(`injected unlink failure: ${path}`)
      },
    }))

    // when
    const result = await runner.launchPending()

    // then
    expect(result.status).toBe("committed")
    const runDir = await onlyRunDir(identity)
    expect(existsSync(join(runDir, "final.json"))).toBe(true)
    expect(existsSync(payloadPath(runDir))).toBe(true)
    expect(collector.warnings.map((entry) => entry.message)).toContain("facts run artifact cleanup failed")
  }, 30_000)

  test("#given a payload already gone #when the run finalizes #then the ENOENT is tolerated silently", async () => {
    // given: the finalize path re-reads the payload, so it is removed just before the sentinel
    // lands - the deletion that follows must treat a missing file as success.
    const { root, identity, queue } = await fixture()
    const collector = warnCollector()
    const runner = new FactsExtractorRunner(runnerOptions(root, identity, queue, "fact", {
      logger: collector.logger,
      writeTerminalSentinel: async (path: string, value: unknown) => {
        const runDir = join(path, "..")
        await Bun.file(payloadPath(runDir)).delete()
        await writeRunJsonAtomic(path, value)
      },
    }))

    // when
    const result = await runner.launchPending()

    // then
    expect(result.status).toBe("committed")
    await expectCleanTerminalRun(await onlyRunDir(identity), "final.json")
    expect(collector.warnings.map((entry) => entry.message)).not.toContain("facts run artifact cleanup failed")
  }, 30_000)
})
