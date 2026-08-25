import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import {
  FactsFailureStore,
  FactsFailuresCorruptError,
  factsQueuePaths,
  type MemoryIdentity,
} from "@oh-my-opencode/memory-core"

import { FactsExtractorRunner } from "./facts-runner"
import { enqueue, fixture, runnerOptions } from "./facts-runner.test-support"
import type { FactsRunLedger } from "./facts-runner-types"
import { writeRunJsonAtomic } from "./worker/run-artifacts"

const NOW = new Date("2026-08-16T12:00:00.000Z")

async function runDirNames(identity: MemoryIdentity): Promise<string[]> {
  return (await readdir(join(identity.paths.facts, "runs")).catch(() => [])).sort()
}

/** Parks an endpoint the only supported way: five consecutive recorded failures. */
async function park(identity: MemoryIdentity, conversationId: string, endMessageId: string, line: number) {
  const store = new FactsFailureStore({ identityPaths: identity.paths, now: () => NOW })
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await store.recordFailure({
      targets: [{ conversationId, endMessageId, endSnapshotLine: line }],
      failureId: `seed-${conversationId}-${attempt}`,
      reason: "child_exit",
    })
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

describe("facts launch gating on failure state", () => {
  test("#given every pending endpoint is parked #when a launch is attempted #then nothing launches and no run dir is reserved", async () => {
    // given
    const { root, identity, queue } = await fixture()
    await park(identity, "session-1", "m1", 1)

    // when
    const result = await new FactsExtractorRunner(
      runnerOptions(root, identity, queue, "fact", { now: () => NOW }),
    ).launchPending()

    // then
    expect(result.status).toBe("empty")
    expect(existsSync(join(identity.paths.facts, "runs"))).toBe(false)
    expect(await queue.listPending()).toHaveLength(1)
  }, 30_000)

  test("#given one parked conversation beside a healthy one #when a launch runs #then only the healthy conversation's entry is carried", async () => {
    // given
    const { root, identity, queue } = await fixture()
    await enqueue(queue, identity, "session-2", "m2", "The project uses TypeScript.")
    await park(identity, "session-1", "m1", 1)

    // when
    const result = await new FactsExtractorRunner(
      runnerOptions(root, identity, queue, "fact", { now: () => NOW }),
    ).launchPending()

    // then
    expect(result.status).toBe("committed")
    const names = await runDirNames(identity)
    expect(names).toHaveLength(1)
    const ledger = JSON.parse(
      await readFile(join(identity.paths.facts, "runs", names[0] ?? "missing", "ledger.json"), "utf8"),
    ) as FactsRunLedger
    expect(ledger.queued).toEqual([
      { conversationId: "session-2", end_message_id: "m2", end_snapshot_line: 1 },
    ])
    const pending = await queue.listPending()
    expect(pending.map((entry) => entry.conversationId)).toEqual(["session-1"])
  }, 30_000)

  test("#given a backoff endpoint #when the clock is before nextEligibleAt #then the launch is empty, and at the instant itself it launches", async () => {
    // given
    const { root, identity, queue } = await fixture()
    await new FactsFailureStore({ identityPaths: identity.paths, now: () => NOW }).recordFailure({
      targets: [{ conversationId: "session-1", endMessageId: "m1", endSnapshotLine: 1 }],
      failureId: "seed-backoff",
      reason: "child_exit",
    })
    const eligibleAt = new Date(NOW.getTime() + 60_000)

    // when
    const early = await new FactsExtractorRunner(
      runnerOptions(root, identity, queue, "fact", { now: () => new Date(eligibleAt.getTime() - 1) }),
    ).launchPending()
    const exact = await new FactsExtractorRunner(
      runnerOptions(root, identity, queue, "fact", { now: () => eligibleAt }),
    ).launchPending()

    // then
    expect(early.status).toBe("empty")
    expect(exact.status).toBe("committed")
    expect(await queue.listPending()).toHaveLength(0)
  }, 30_000)

  test("#given a legacy failure record anchored at snapshot line 0 #when a launch is attempted #then the pair still gates the entry", async () => {
    // given: a ledger written before `end_snapshot_line` existed anchors its endpoints at 0.
    const { root, identity, queue } = await fixture()
    await park(identity, "session-1", "m1", 0)

    // when
    const result = await new FactsExtractorRunner(
      runnerOptions(root, identity, queue, "fact", { now: () => NOW }),
    ).launchPending()

    // then
    expect(result.status).toBe("empty")
    expect(existsSync(join(identity.paths.facts, "runs"))).toBe(false)
  }, 30_000)

  test("#given a corrupt failures.json #when a launch is attempted #then the launch aborts with a typed warning and reserves nothing", async () => {
    // given
    const { root, identity, queue } = await fixture()
    const layout = factsQueuePaths(identity.paths)
    await mkdir(layout.queueDir, { recursive: true })
    await writeFile(layout.failuresPath, "{ not json", "utf8")
    const collector = warnCollector()

    // when
    const result = await new FactsExtractorRunner(
      runnerOptions(root, identity, queue, "fact", { now: () => NOW, logger: collector.logger }),
    ).launchPending()

    // then
    expect(result.status).toBe("skipped")
    expect(existsSync(join(identity.paths.facts, "runs"))).toBe(false)
    expect(collector.warnings.map((warning) => warning.message)).toEqual([
      "facts failure ledger is unreadable; refusing to launch",
    ])
    expect(collector.warnings[0]?.fields).toMatchObject({
      error: new FactsFailuresCorruptError("").name,
    })
    expect(await queue.listPending()).toHaveLength(1)
  }, 30_000)

  test("#given a reconcilable dead run whose endpoints are now parked #when reconcile runs #then the run reconciles but nothing relaunches", async () => {
    // given: a dead run past its deadline; reconciliation must still finish it.
    const { root, identity, queue } = await fixture()
    const runDir = join(identity.paths.facts, "runs", "facts-dead-1")
    await mkdir(runDir, { recursive: true })
    await writeRunJsonAtomic(join(runDir, "ledger.json"), {
      version: 1,
      runId: "facts-dead-1",
      kind: "facts",
      startedAt: "2026-08-10T12:00:00.000Z",
      hardDeadlineAt: Date.parse("2026-08-10T12:01:00.000Z"),
      terminationGraceMs: 100,
      deadlineAt: Date.parse("2026-08-10T12:01:00.100Z"),
      batchId: "11111111-1111-4111-8111-111111111111",
      queued: [{ conversationId: "session-1", end_message_id: "m1", end_snapshot_line: 1 }],
      pid: 1,
      processStart: "not-the-live-process",
    } satisfies FactsRunLedger)
    await park(identity, "session-1", "m1", 1)

    // when
    const result = await new FactsExtractorRunner(
      runnerOptions(root, identity, queue, "fact", { now: () => NOW }),
    ).reconcilePending()

    // then
    expect(result.status).toBe("empty")
    expect(existsSync(join(runDir, "abandoned.json")) || existsSync(join(runDir, "final.json"))).toBe(true)
    expect(await runDirNames(identity)).toEqual(["facts-dead-1"])
  }, 30_000)
})
