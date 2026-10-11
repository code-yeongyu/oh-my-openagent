import { afterEach, describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { appendFile, mkdtemp, readFile, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  MEMORY_KILL_POINTS,
  appendMemoryReceipt,
  appendMemoryReceiptOnce,
  maybeKillAt,
  readMemoryReceipts,
  receiptIdentity,
  receiptsPath,
} from "./index"
import { removeTree } from "../../../../test-support/remove-tree"

const worker = fileURLToPath(new URL("./receipts-worker.test-support.ts", import.meta.url))
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => removeTree(dir, { maxRetries: 10, retryDelay: 200 })))
})

async function runtimeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "memory-receipts-"))
  tempDirs.push(dir)
  return dir
}

function runWorker(dir: string, mode: "append" | "once", count: number, runId: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker, dir, mode, String(count), runId], { stdio: ["ignore", "ignore", "pipe"] })
    let stderr = ""
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8") })
    child.once("error", reject)
    child.once("exit", (code) => code === 0 ? resolve(code) : reject(new Error(`worker exited ${String(code)}: ${stderr}`)))
  })
}

async function lines(dir: string): Promise<string[]> {
  return (await readFile(receiptsPath(dir), "utf8")).split("\n").filter(Boolean)
}

describe("memory receipts", () => {
  test("#given a launched dream #when appended #then one private line records who, what and where", async () => {
    // given
    const dir = await runtimeDir()

    // when
    await appendMemoryReceipt(dir, { kind: "dream", runId: "run-1", trigger: "idle", event: "launched", generation: "2026-01-01T00:00:00.000Z" })

    // then
    const written = await lines(dir)
    expect(written).toHaveLength(1)
    const receipt = JSON.parse(written[0] ?? "{}")
    expect(receipt).toMatchObject({ v: 1, kind: "dream", runId: "run-1", trigger: "idle", event: "launched", pid: process.pid })
    expect(typeof receipt.host).toBe("string")
    expect(Number.isNaN(Date.parse(receipt.at))).toBe(false)
    if (process.platform !== "win32") expect((await stat(receiptsPath(dir))).mode & 0o777).toBe(0o600)
  })

  test("#given appends racing in one process and three child processes #when they finish #then every line is whole", async () => {
    // given
    const dir = await runtimeDir()

    // when
    await Promise.all([
      ...Array.from({ length: 20 }, (_, index) => appendMemoryReceipt(dir, { kind: "dream", runId: `local-${index}`, trigger: "idle", event: "launched", generation: "g1" })),
      runWorker(dir, "append", 10, "child-a"),
      runWorker(dir, "append", 10, "child-b"),
      runWorker(dir, "append", 10, "child-c"),
    ])

    // then
    const written = await lines(dir)
    expect(written).toHaveLength(50)
    expect(written.every((line) => JSON.parse(line).event === "launched")).toBe(true)
    expect(new Set(written.map((line) => JSON.parse(line).runId)).size).toBe(50)
  }, 30_000)

  test("#given a long or secret-bearing detail #when appended #then it is cut to 400 characters and masked", async () => {
    // given
    const dir = await runtimeDir()

    // when
    await appendMemoryReceipt(dir, { kind: "facts", batchId: "b-1", trigger: "settle", event: "failed", detail: `push token=abc123456 ${"x".repeat(600)}` })

    // then
    const receipt = JSON.parse((await lines(dir))[0] ?? "{}")
    expect(receipt.detail).not.toContain("abc123456")
    expect(receipt.detail).toContain("***")
    expect(receipt.detail.length).toBeLessThanOrEqual(400)
    expect(receipt.detail.endsWith("...")).toBe(true)
  })

  test("#given mixed kinds and a line cut off by a crash #when read #then the newest of one kind return and the partial line is counted", async () => {
    // given
    const dir = await runtimeDir()
    for (let index = 0; index < 7; index++) {
      await appendMemoryReceipt(dir, { kind: "dream", runId: `d-${index}`, trigger: "idle", event: "merged", generation: `g${index}` })
      await appendMemoryReceipt(dir, { kind: "reflection", runId: `r-${index}`, trigger: "step", event: "no_changes", generation: `g${index}` })
    }
    await appendFile(receiptsPath(dir), "{\"v\":1,\"kind\":\"dream\",\"runId\":\"cut")

    // when
    const read = await readMemoryReceipts(dir, { kind: "dream", limit: 5 })

    // then
    expect(read.receipts.map((receipt) => receipt.kind === "facts" ? receipt.batchId : receipt.runId)).toEqual(["d-6", "d-5", "d-4", "d-3", "d-2"])
    expect(read.skippedPartialLines).toBe(1)
  })

  test("#given no receipts file #when read #then nothing is returned and nothing is skipped", async () => {
    // given
    const dir = await runtimeDir()

    // when
    const read = await readMemoryReceipts(dir, {})

    // then
    expect(read).toEqual({ receipts: [], skippedPartialLines: 0 })
  })

  test("#given the same merge reported from four processes #when appended once #then exactly one line exists, and a different event still lands", async () => {
    // given
    const dir = await runtimeDir()
    const merged = { kind: "dream" as const, runId: "same", trigger: "idle", event: "merged" as const, generation: "g1" }

    // when
    await Promise.all([
      ...Array.from({ length: 10 }, () => appendMemoryReceiptOnce(dir, merged)),
      runWorker(dir, "once", 5, "same"),
      runWorker(dir, "once", 5, "same"),
      runWorker(dir, "once", 5, "same"),
    ])
    const launched = await appendMemoryReceiptOnce(dir, { ...merged, event: "launched" })
    const again = await appendMemoryReceiptOnce(dir, merged)

    // then
    const written = (await lines(dir)).map((line) => JSON.parse(line))
    expect(written.filter((receipt) => receipt.event === "merged")).toHaveLength(1)
    expect(written.filter((receipt) => receipt.event === "launched")).toHaveLength(1)
    expect(launched).toBe(true)
    expect(again).toBe(false)
  }, 30_000)

  test("#given one run in two generations #when identities are compared #then generations stay apart and a re-read ledger gives the same key", async () => {
    // given
    const ledger = { runId: "run-x", startedAt: "2026-01-01T00:00:00.000Z" }
    const reread = JSON.parse(JSON.stringify(ledger)) as typeof ledger

    // when
    const live = receiptIdentity({ kind: "dream", runId: ledger.runId, event: "merged", generation: ledger.startedAt })
    const backfilled = receiptIdentity({ kind: "dream", runId: reread.runId, event: "merged", generation: reread.startedAt })
    const retired = receiptIdentity({ kind: "dream", runId: ledger.runId, event: "merged", generation: "2025-12-31T00:00:00.000Z" })
    const facts = receiptIdentity({ kind: "facts", batchId: "batch-1", event: "committed" })

    // then
    expect(backfilled).toBe(live)
    expect(retired).not.toBe(live)
    expect(facts).toBe(receiptIdentity({ kind: "facts", batchId: "batch-1", event: "committed" }))
  })

  test("#given kill points #when the variable is unset, different, or matching #then only a match kills this process with the platform's signal", () => {
    // given
    const kills: Array<{ readonly pid: number; readonly signal: string | undefined }> = []
    const kill = (pid: number, signal?: NodeJS.Signals) => { kills.push({ pid, signal }) }
    const previous = process.env.OMO_MEMORY_KILL_POINT

    // when
    try {
      delete process.env.OMO_MEMORY_KILL_POINT
      const unset = maybeKillAt("after-merge", { kill })
      process.env.OMO_MEMORY_KILL_POINT = "after-validate"
      const other = maybeKillAt("after-merge", { kill })
      process.env.OMO_MEMORY_KILL_POINT = "after-merge"
      const hit = maybeKillAt("after-merge", { kill, platform: "linux" })
      const hitWindows = maybeKillAt("after-merge", { kill, platform: "win32" })

      // then
      expect([unset, other]).toEqual([undefined, undefined])
      expect(hit).toBe("signal")
      expect(hitWindows).toBe("terminate")
      expect(kills).toEqual([{ pid: process.pid, signal: "SIGKILL" }, { pid: process.pid, signal: undefined }])
      expect(MEMORY_KILL_POINTS).toEqual(["after-reserve", "after-prelaunch", "after-worktree", "after-child-exit", "after-validate", "after-merge", "before-receipt"])
    } finally {
      if (previous === undefined) delete process.env.OMO_MEMORY_KILL_POINT
      else process.env.OMO_MEMORY_KILL_POINT = previous
    }
  })

  test("#given a fresh runtime dir with no locks dir #when appended #then the receipts lock is taken under runtime/locks and the append lands", async () => {
    // given
    const dir = await runtimeDir()

    // when
    await appendMemoryReceipt(dir, { kind: "reflection", runId: "r", trigger: "manual", event: "launched", generation: "g" })

    // then
    expect((await stat(join(dir, "locks"))).isDirectory()).toBe(true)
    expect(await lines(dir)).toHaveLength(1)
  })
})
