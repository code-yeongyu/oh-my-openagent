import { afterEach, describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"

import { readRunDeadline, settleReclaimedReservation } from "./reflection-reclaim-settlement"
import { writeRunJsonAtomic } from "./worker/run-artifacts"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))))

async function fixture() {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "reclaim-settlement-")))
  roots.push(root)
  const paths = buildIdentityPaths(root, "agent-test")
  const runDir = join(paths.reflection, "runs", "reflection-run-4")
  await mkdir(runDir, { recursive: true, mode: 0o700 })
  return { paths, runDir }
}

const reclaimed = {
  run: {
    runId: "reflection-run-4",
    request: { trigger: "step-count" as const, conversationIds: ["conversation-a"], snapshots: [] },
    reservedAt: "2026-08-17T11:12:35.419Z",
  },
  reason: "deadline_expired" as const,
  detail: "run deadline 2026-08-17T11:27:35.486Z passed and finalization did not complete",
}

describe("reclaimed reservation settlement", () => {
  test("#given a run ledger recording a deadline #when the reclaim seam reads it #then the deadline is resolved", async () => {
    // given
    const { paths, runDir } = await fixture()
    await writeRunJsonAtomic(join(runDir, "ledger.json"), {
      version: 1,
      runId: "reflection-run-4",
      kind: "reflection",
      category: "quick",
      conversationIds: ["conversation-a"],
      trigger: "step-count",
      startedAt: "2026-08-17T11:12:38.654Z",
      hardDeadlineAt: 1_786_966_055_486,
      terminationGraceMs: 5_000,
      deadlineAt: 1_786_966_060_486,
      mergePolicy: "auto",
      worktreeDir: join(paths.worktrees, "w"),
      worktreeBranch: "memory/reflection-x",
      baseSha: "abc",
      gitFilePath: join(paths.worktrees, "w", ".git"),
      gitFileSnapshot: "gitdir: x",
      commonConfigPath: join(paths.repo, ".git", "config"),
      commonConfigSnapshot: "[core]",
    })

    // when
    const deadline = await readRunDeadline(paths, "reflection-run-4")

    // then
    expect(deadline).toBe(1_786_966_060_486)
  })

  test("#given no readable ledger #when the reclaim seam reads it #then no deadline is reported", async () => {
    // given
    const { paths } = await fixture()

    // when
    const deadline = await readRunDeadline(paths, "reflection-run-missing")

    // then
    expect(deadline).toBeUndefined()
  })

  test("#given a reclaimed reservation #when it is settled #then a failed completion record is published so the run stops reporting itself as reflecting", async () => {
    // given
    const { paths } = await fixture()

    // when
    await settleReclaimedReservation({
      identity: "agent-test",
      paths,
      reclaimed,
      now: () => new Date("2026-08-17T15:17:00.000Z"),
    })

    // then
    const record = JSON.parse(await readFile(
      join(paths.reflection, "completions", "reflection-run-4.json"),
      "utf8",
    ))
    expect(record).toMatchObject({
      runId: "reflection-run-4",
      outcome: "failed",
      reason: "reservation_reclaimed",
      conversationIds: ["conversation-a"],
      delivery: { status: "pending" },
    })
    expect(record.detail).toContain("deadline")
  })

  test("#given a run that already published a completion #when its reservation is reclaimed #then the existing record is not overwritten", async () => {
    // given
    const { paths } = await fixture()
    const completionsDir = join(paths.reflection, "completions")
    await mkdir(completionsDir, { recursive: true, mode: 0o700 })
    await writeRunJsonAtomic(join(completionsDir, "reflection-run-4.json"), {
      schemaVersion: 1,
      runId: "reflection-run-4",
      identity: "agent-test",
      category: "quick",
      conversationIds: ["conversation-a"],
      trigger: "step-count",
      outcome: "merged",
      startedAt: "2026-08-17T11:12:38.654Z",
      finishedAt: "2026-08-17T11:14:00.000Z",
      delivery: { status: "consumed" },
    })

    // when
    await settleReclaimedReservation({
      identity: "agent-test",
      paths,
      reclaimed,
      now: () => new Date("2026-08-17T15:17:00.000Z"),
    })

    // then
    expect(JSON.parse(await readFile(join(completionsDir, "reflection-run-4.json"), "utf8")))
      .toMatchObject({ outcome: "merged" })
  })
})
