import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  FactsFailureStore,
  buildIdentityPaths,
  readMemoryReceipts,
  type MemoryIdentityPaths,
  type MemoryReceiptInput,
} from "@oh-my-opencode/memory-core"

import { FactsTerminalWrites } from "./facts-terminal-writes"
import { reconcileFactsRuns } from "./facts-run-reconcile"
import { reserveFactsRunDir } from "./facts-run-storage"
import type { MemoryReceiptsPort } from "./receipts-port"
import { writeRunJsonAtomic } from "./worker/run-artifacts"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const NOW = new Date("2026-08-11T10:00:00.000Z")
const target = { conversationId: "conversation-a", endMessageId: "m-9", endSnapshotLine: 9 }

async function factsRun(): Promise<{ paths: MemoryIdentityPaths; runDir: string; batchId: string }> {
  const root = await mkdtemp(join(tmpdir(), "facts-receipts-"))
  roots.push(root)
  const paths = buildIdentityPaths(root, "agent-test")
  const batchId = "batch-0001"
  const runDir = join(paths.facts, "runs", "facts-abc-1")
  await mkdir(runDir, { recursive: true })
  await writeRunJsonAtomic(join(runDir, "ledger.json"), {
    version: 1, runId: "facts-abc-1", kind: "facts", startedAt: NOW.toISOString(),
    hardDeadlineAt: 1, terminationGraceMs: 1, deadlineAt: 2, batchId, queued: [],
  })
  return { paths, runDir, batchId }
}

function writes(paths: MemoryIdentityPaths, receipts?: MemoryReceiptsPort): FactsTerminalWrites {
  return new FactsTerminalWrites({
    failures: new FactsFailureStore({ identityPaths: paths, now: () => NOW }),
    now: () => NOW,
    markConsumed: async () => undefined,
    receiptsDir: paths.runtime,
    ...(receipts === undefined ? {} : { receipts }),
  })
}

async function read(paths: MemoryIdentityPaths) {
  return [...(await readMemoryReceipts(paths.runtime, { kind: "facts" })).receipts].reverse()
}

describe("facts receipts", () => {
  test("#given a committed batch #when it succeeds #then one committed receipt carries the batch id and sha", async () => {
    // given
    const { paths, runDir, batchId } = await factsRun()

    // when
    await writes(paths).succeed(runDir, "facts-abc-1", "committed", { entries: [], targets: [] }, "f00d")

    // then
    expect(await read(paths)).toMatchObject([{ kind: "facts", batchId, event: "committed", sha: "f00d" }])
  })

  test("#given an empty extraction #when it succeeds #then the receipt says no_facts", async () => {
    // given
    const { paths, runDir } = await factsRun()

    // when
    await writes(paths).succeed(runDir, "facts-abc-1", "no_facts", { entries: [], targets: [] })

    // then
    expect((await read(paths)).map((receipt) => receipt.event)).toEqual(["no_facts"])
  })

  test("#given a failure that parks its endpoint #when recorded #then failed and parked receipts follow the sentinel", async () => {
    // given
    const { paths, runDir, batchId } = await factsRun()
    const order: Array<{ readonly event: string; readonly sentinel: boolean }> = []
    const port: MemoryReceiptsPort = {
      append: async (runtimeDir: string, input: MemoryReceiptInput) => {
        order.push({ event: input.event, sentinel: existsSync(join(runDir, "final.json")) })
        const { appendMemoryReceiptOnce } = await import("@oh-my-opencode/memory-core")
        return appendMemoryReceiptOnce(runtimeDir, input)
      },
    }

    // when
    await writes(paths, port).fail({ runDir, runId: "facts-abc-1", batchId, targets: [target], reason: "secret_like_content", detail: "refused" })

    // then
    expect(order).toEqual([{ event: "failed", sentinel: true }, { event: "parked", sentinel: true }])
    expect(await read(paths)).toMatchObject([
      { batchId, event: "failed", reason: "secret_like_content" },
      { batchId, event: "parked", reason: "secret_like_content" },
    ])
  })

  test("#given a failure that only backs off #when recorded #then failed is receipted and parked is not", async () => {
    // given
    const { paths, runDir, batchId } = await factsRun()

    // when
    await writes(paths).fail({ runDir, runId: "facts-abc-1", batchId, targets: [target], reason: "child_exit", detail: "exit 1" })

    // then
    expect((await read(paths)).map((receipt) => receipt.event)).toEqual(["failed"])
  })

  test("#given a run reconciliation cannot prove dead #when abandoned #then an abandoned receipt follows abandoned.json", async () => {
    // given
    const { paths, runDir, batchId } = await factsRun()
    const ledger = { version: 1 as const, runId: "facts-abc-1", kind: "facts" as const, startedAt: NOW.toISOString(), hardDeadlineAt: 1, terminationGraceMs: 1, deadlineAt: 2, batchId, queued: [] }

    // when
    await writes(paths).abandon(runDir, ledger, "unknown_liveness")

    // then
    expect(existsSync(join(runDir, "abandoned.json"))).toBe(true)
    expect(await read(paths)).toMatchObject([{ batchId, event: "abandoned", reason: "unknown_liveness" }])
  })

  test("#given a receipt write that fails #when the batch succeeds #then the run still finishes and final.json lands", async () => {
    // given
    const { paths, runDir } = await factsRun()
    const broken: MemoryReceiptsPort = { append: async () => { throw new Error("disk full") } }

    // when
    await writes(paths, broken).succeed(runDir, "facts-abc-1", "committed", { entries: [], targets: [] }, "f00d")

    // then
    expect(existsSync(join(runDir, "final.json"))).toBe(true)
    expect(await read(paths)).toEqual([])
  })

  test("#given a facts batch reserved for launch #when its run dir is claimed #then a launched receipt carries its batch id", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "facts-receipts-launch-"))
    roots.push(root)
    const paths = buildIdentityPaths(root, "agent-test")

    // when
    const runDir = await reserveFactsRunDir({
      factsDir: paths.facts,
      locksDir: paths.locks,
      entries: [],
      batchId: "batch-launch",
      launchedAt: NOW.getTime(),
      receiptsDir: paths.runtime,
    })

    // then
    expect(runDir).toBeDefined()
    expect(await read(paths)).toMatchObject([{ kind: "facts", batchId: "batch-launch", event: "launched" }])
  })
})

describe("facts receipt recovery", () => {
  const reconcile = (paths: MemoryIdentityPaths) => reconcileFactsRuns({
    factsDir: paths.facts,
    now: () => NOW,
    finalize: async () => { throw new Error("a terminal run is never finalized again") },
    fail: async () => { throw new Error("a terminal run is never failed again") },
    abandon: async () => { throw new Error("a terminal run is never abandoned again") },
    receiptsDir: paths.runtime,
  })

  test("#given a committed run whose receipt write was lost #when facts reconcile twice #then exactly one committed receipt is rebuilt from final.json", async () => {
    // given
    const { paths, runDir, batchId } = await factsRun()
    const lost: MemoryReceiptsPort = { append: async () => { throw new Error("receipt write lost") } }
    await writes(paths, lost).succeed(runDir, "facts-abc-1", "committed", { entries: [], targets: [] }, "f00d")
    const afterLoss = await read(paths)

    // when
    await reconcile(paths)
    await reconcile(paths)

    // then
    expect(afterLoss).toEqual([])
    expect((await read(paths)).map((receipt) => [receipt.kind === "facts" ? receipt.batchId : "", receipt.event, receipt.sha])).toEqual([[batchId, "committed", "f00d"]])
  })

  test("#given a terminal run whose receipt was already written #when facts reconcile #then no second receipt appears", async () => {
    // given
    const { paths, runDir } = await factsRun()
    await writes(paths).succeed(runDir, "facts-abc-1", "no_facts", { entries: [], targets: [] })

    // when
    await reconcile(paths)

    // then
    expect((await read(paths)).map((receipt) => receipt.event)).toEqual(["no_facts"])
  })

  test("#given a finished facts run whose ledger is gone #when facts reconcile #then no receipt is guessed and the skip is logged once", async () => {
    // given
    const { paths, runDir } = await factsRun()
    await writes(paths, { append: async () => { throw new Error("receipt write lost") } }).succeed(runDir, "facts-abc-1", "no_facts", { entries: [], targets: [] })
    await rm(join(runDir, "ledger.json"))
    const warnings: string[] = []

    // when
    await reconcileFactsRuns({
      factsDir: paths.facts,
      now: () => NOW,
      finalize: async () => { throw new Error("a terminal run is never finalized again") },
      fail: async () => { throw new Error("a terminal run is never failed again") },
      abandon: async () => { throw new Error("a terminal run is never abandoned again") },
      receiptsDir: paths.runtime,
      warn: (message) => warnings.push(message),
    })

    // then
    expect(await read(paths)).toEqual([])
    expect(warnings).toEqual(["facts receipt backfill skipped: ledger unreadable"])
  })

  test("#given a batch whose ledger is unparseable text #when it succeeds #then the warning carries no part of the file", async () => {
    // given
    const { paths, runDir } = await factsRun()
    await writeFile(join(runDir, "ledger.json"), "ghp_AAAABBBBCCCCDDDD1111")
    const logged: string[] = []
    const terminal = new FactsTerminalWrites({
      failures: new FactsFailureStore({ identityPaths: paths, now: () => NOW }),
      now: () => NOW,
      markConsumed: async () => undefined,
      receiptsDir: paths.runtime,
      warn: (message, fields) => logged.push(JSON.stringify({ message, fields })),
    })

    // when
    await terminal.succeed(runDir, "facts-abc-1", "no_facts", { entries: [], targets: [] })

    // then
    expect(logged).toHaveLength(1)
    expect(logged[0]).not.toContain("CCCCDDDD1111")
  })

  test.each([
    ["is gone", "facts receipt skipped: ledger unreadable"],
    ["names another run", "facts receipt skipped: ledger does not name this run"],
  ] as const)("#given a batch whose ledger %s #when it succeeds #then no receipt is guessed and the skip is logged", async (state, expected) => {
    // given
    const { paths, runDir } = await factsRun()
    if (state === "is gone") await rm(join(runDir, "ledger.json"))
    else await writeRunJsonAtomic(join(runDir, "ledger.json"), { version: 1, runId: "facts-other", batchId: "batch-0009" })
    const warnings: string[] = []
    const terminal = new FactsTerminalWrites({
      failures: new FactsFailureStore({ identityPaths: paths, now: () => NOW }),
      now: () => NOW,
      markConsumed: async () => undefined,
      receiptsDir: paths.runtime,
      warn: (message) => warnings.push(message),
    })

    // when
    await terminal.succeed(runDir, "facts-abc-1", "no_facts", { entries: [], targets: [] })

    // then
    expect(await read(paths)).toEqual([])
    expect(warnings).toEqual([expected])
  })

  test("#given a launched receipt write that fails #when a facts run dir is reserved #then the failure is reported to warn and the run dir is still claimed", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "facts-receipts-"))
    roots.push(root)
    const paths = buildIdentityPaths(root, "agent-test")
    const warnings: string[] = []

    // when
    const runDir = await reserveFactsRunDir({
      factsDir: paths.facts,
      locksDir: paths.locks,
      entries: [],
      batchId: "batch-0002",
      launchedAt: NOW.getTime(),
      receiptsDir: paths.runtime,
      receipts: { append: async () => { throw new Error("disk full") } },
      warn: (message) => warnings.push(message),
    })

    // then
    expect(runDir).toBeDefined()
    expect(warnings).toHaveLength(1)
  })
})
