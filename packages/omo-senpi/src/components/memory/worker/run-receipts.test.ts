import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  appendMemoryReceiptOnce,
  buildIdentityPaths,
  readMemoryReceipts,
  receiptIdentity,
  type MemoryIdentity,
  type MemoryReceiptInput,
} from "@oh-my-opencode/memory-core"

import type { MemoryReceiptsPort } from "../receipts-port"
import { writeRunJsonAtomic } from "./run-artifacts"
import { abandonReservationRun, type ReservationStatePort } from "./run-finalization"
import { settleReservationRun } from "./run-finalization-settlement"
import { reconcileReflectionRuns } from "./run-reconciliation"
import type { ReservationRunLedger } from "./reservation-run-ledger"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const NOW = Date.parse("2026-08-11T10:01:00.000Z")
const idle: ReservationStatePort = {
  readState: async () => ({}),
  complete: async (_runId, outcome) => ({ outcome }),
}

function ledger(overrides: Partial<ReservationRunLedger> = {}): ReservationRunLedger {
  return {
    version: 1,
    runId: "run-1",
    category: "deep",
    conversationIds: ["conversation-a"],
    kind: "reflection",
    trigger: "step-count",
    startedAt: "2026-08-11T10:00:00.000Z",
    hardDeadlineAt: 1,
    terminationGraceMs: 1,
    deadlineAt: 2,
    mergePolicy: "auto",
    worktreeDir: "/tmp/worktree",
    worktreeBranch: "memory/reflection-run-1",
    baseSha: "base",
    gitFilePath: "/tmp/worktree/.git",
    gitFileSnapshot: "gitdir: x\n",
    commonConfigPath: "/tmp/config",
    commonConfigSnapshot: null,
    ...overrides,
  }
}

async function identityWithRun(runLedger: ReservationRunLedger | undefined = ledger()): Promise<{ identity: MemoryIdentity; runDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "run-receipts-"))
  roots.push(root)
  const identity: MemoryIdentity = { id: "agent-test", safeSlug: "agent-test", paths: buildIdentityPaths(root, "agent-test") }
  const runDir = join(identity.paths.reflection, "runs", runLedger?.runId ?? "run-1")
  await mkdir(runDir, { recursive: true })
  if (runLedger !== undefined) await writeRunJsonAtomic(join(runDir, "ledger.json"), runLedger)
  return { identity, runDir }
}

function orderingPort(runDir: string, failEvent?: string): MemoryReceiptsPort & { calls: Array<{ event: string; artifactPresent: boolean; failed: boolean }> } {
  const calls: Array<{ event: string; artifactPresent: boolean; failed: boolean }> = []
  return {
    calls,
    async append(runtimeDir: string, input: MemoryReceiptInput) {
      const artifactPresent = existsSync(join(runDir, "final.json")) || existsSync(join(runDir, "abandoned.json"))
      const failed = input.event === failEvent
      calls.push({ event: input.event, artifactPresent, failed })
      if (failed) throw new Error(`receipt write failed for ${input.event}`)
      return appendMemoryReceiptOnce(runtimeDir, input)
    },
  }
}

async function receipts(identity: MemoryIdentity) {
  return (await readMemoryReceipts(identity.paths.runtime, {})).receipts
}

describe("maintenance run receipts", () => {
  test("#given a merged settlement #when final.json lands #then one merged receipt with the integration sha follows it", async () => {
    // given
    const { identity, runDir } = await identityWithRun()
    const port = orderingPort(runDir)

    // when
    await settleReservationRun({ identity, reservation: idle, now: () => NOW, receipts: port }, runDir, ledger(), {
      outcome: "merged",
      integrationSha: "abc123",
    })

    // then
    expect(port.calls).toEqual([{ event: "merged", artifactPresent: true, failed: false }])
    expect(await receipts(identity)).toMatchObject([
      { kind: "reflection", runId: "run-1", event: "merged", sha: "abc123", trigger: "step-count", generation: "2026-08-11T10:00:00.000Z" },
    ])
  })

  test("#given no-change and failed settlements #when settled #then no_changes and failed (with the reason and a masked detail) are receipted", async () => {
    // given
    const noChange = await identityWithRun()
    const failed = await identityWithRun()

    // when
    await settleReservationRun({ identity: noChange.identity, reservation: idle, now: () => NOW }, noChange.runDir, ledger(), { outcome: "no_changes" })
    await settleReservationRun({ identity: failed.identity, reservation: idle, now: () => NOW }, failed.runDir, ledger(), {
      outcome: "failed",
      reason: "validation_failed",
      detail: "secret token=abc123456 leaked",
    })

    // then
    expect((await receipts(noChange.identity)).map((receipt) => receipt.event)).toEqual(["no_changes"])
    const [receipt] = await receipts(failed.identity)
    expect(receipt).toMatchObject({ event: "failed", reason: "validation_failed" })
    expect(receipt?.detail).not.toContain("abc123456")
  })

  test("#given a dead run nobody can finish #when abandoned #then abandoned.json carries the generation and an abandoned receipt follows it", async () => {
    // given
    const { identity, runDir } = await identityWithRun()
    const port = orderingPort(runDir)
    const dead = { getPidLiveness: () => "dead" as const, getProcessStartIdentity: async () => null }

    // when
    await abandonReservationRun({ identity, reservation: idle, now: () => NOW, receipts: port, ...dead }, runDir, ledger())

    // then
    expect(JSON.parse(await readFile(join(runDir, "abandoned.json"), "utf8")).generation).toBe("2026-08-11T10:00:00.000Z")
    expect(port.calls).toEqual([{ event: "abandoned", artifactPresent: true, failed: false }])
    expect((await receipts(identity)).map((receipt) => receipt.event)).toEqual(["abandoned"])
  })

  test("#given a merged run whose receipt write failed #when reconciled twice with the real writer #then exactly one merged receipt exists with the live identity", async () => {
    // given
    const { identity, runDir } = await identityWithRun()
    const port = orderingPort(runDir, "merged")
    await settleReservationRun({ identity, reservation: idle, now: () => NOW, receipts: port }, runDir, ledger(), {
      outcome: "merged",
      integrationSha: "abc123",
    })

    // when
    const after = { failedWrites: port.calls.filter((call) => call.failed).length, lines: (await receipts(identity)).length }
    await reconcileReflectionRuns({ identity, reservation: idle, now: () => NOW })
    await reconcileReflectionRuns({ identity, reservation: idle, now: () => NOW })

    // then
    expect(after).toEqual({ failedWrites: 1, lines: 0 })
    expect(existsSync(join(runDir, "final.json"))).toBe(true)
    const merged = (await receipts(identity)).filter((receipt) => receipt.event === "merged")
    expect(merged).toHaveLength(1)
    expect(receiptIdentity({ kind: "reflection", runId: "run-1", event: "merged", generation: merged[0]?.kind === "facts" ? "" : merged[0]?.generation ?? "" }))
      .toBe(receiptIdentity({ kind: "reflection", runId: ledger().runId, event: "merged", generation: ledger().startedAt }))
    expect(merged[0]).toMatchObject({ sha: "abc123" })
  })

  test("#given a normally receipted run #when reconciled after a restart #then no second merged line appears", async () => {
    // given
    const { identity, runDir } = await identityWithRun()
    await settleReservationRun({ identity, reservation: idle, now: () => NOW }, runDir, ledger(), { outcome: "merged", integrationSha: "abc123" })

    // when
    await reconcileReflectionRuns({ identity, reservation: idle, now: () => NOW })
    await reconcileReflectionRuns({ identity, reservation: idle, now: () => NOW })

    // then
    expect((await receipts(identity)).map((receipt) => receipt.event)).toEqual(["merged"])
  })

  test("#given a run dir reused by a fresh generation #when each generation is reconciled #then two distinct merged receipts exist", async () => {
    // given
    const { identity, runDir } = await identityWithRun()
    await writeRunJsonAtomic(join(runDir, "final.json"), { version: 1, runId: "run-1", outcome: "merged", finishedAt: "2026-08-11T10:00:30.000Z" })
    await reconcileReflectionRuns({ identity, reservation: idle, now: () => NOW })

    // when
    await writeRunJsonAtomic(join(runDir, "ledger.json"), ledger({ startedAt: "2026-08-12T09:00:00.000Z" }))
    await writeRunJsonAtomic(join(runDir, "final.json"), { version: 1, runId: "run-1", outcome: "merged", finishedAt: "2026-08-12T09:00:30.000Z" })
    await reconcileReflectionRuns({ identity, reservation: idle, now: () => NOW })

    // then
    const merged = (await receipts(identity)).filter((receipt) => receipt.event === "merged")
    expect(merged.map((receipt) => receipt.kind === "facts" ? "" : receipt.generation).sort())
      .toEqual(["2026-08-11T10:00:00.000Z", "2026-08-12T09:00:00.000Z"])
  })

  for (const kind of ["reflection", "dream"] as const) {
    test(`#given a pre-ledger ${kind} abandoned.json #when reconciled twice #then one abandoned receipt keyed by the sentinel's own generation`, async () => {
      // given
      const { identity, runDir } = await identityWithRun(undefined)
      await writeRunJsonAtomic(join(runDir, "abandoned.json"), {
        version: 1,
        runId: "run-1",
        kind,
        trigger: kind === "dream" ? "dream" : "step-count",
        ...(kind === "dream" ? { origin: "idle" } : {}),
        generation: "2026-08-11T09:59:00.000Z",
        reason: "launch_interrupted",
        abandonedAt: "2026-08-11T10:00:05.000Z",
      })

      // when
      await reconcileReflectionRuns({ identity, reservation: idle, now: () => NOW })
      await reconcileReflectionRuns({ identity, reservation: idle, now: () => NOW })

      // then
      expect(await receipts(identity)).toMatchObject([
        { kind, runId: "run-1", event: "abandoned", generation: "2026-08-11T09:59:00.000Z", reason: "launch_interrupted" },
      ])
    })
  }

  test("#given quarantined.json beside an unreadable ledger #when reconciled #then one quarantined receipt keyed by the sentinel's generation", async () => {
    // given
    const { identity, runDir } = await identityWithRun(undefined)
    await Bun.write(join(runDir, "ledger.json"), "{ not json")
    await writeRunJsonAtomic(join(runDir, "quarantined.json"), {
      version: 1,
      runId: "run-1",
      kind: "dream",
      trigger: "dream",
      generation: "2026-08-11T09:58:00.000Z",
      reason: "ledger_unreadable",
      quarantinedAt: "2026-08-11T10:00:10.000Z",
    })

    // when
    await reconcileReflectionRuns({ identity, reservation: idle, now: () => NOW })

    // then
    expect(await receipts(identity)).toMatchObject([
      { kind: "dream", runId: "run-1", event: "quarantined", generation: "2026-08-11T09:58:00.000Z", reason: "ledger_unreadable" },
    ])
  })
})
