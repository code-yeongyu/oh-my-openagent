import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths, type MemoryIdentity, type ReservedRun } from "@oh-my-opencode/memory-core"

import { writeRunJsonAtomic } from "./run-artifacts"
import { settleReservationRun } from "./run-finalization-settlement"
import type { ReservationRunLedger } from "./reservation-run-ledger"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

function ledger(): ReservationRunLedger {
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
  }
}

describe("run finalization settlement", () => {
  test("#given settlement already cleared the active run #when retried #then completion and final are repaired without completing twice", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "run-finalization-settlement-"))
    roots.push(root)
    const identity: MemoryIdentity = {
      id: "agent-test",
      safeSlug: "agent-test",
      paths: buildIdentityPaths(root, "agent-test"),
    }
    const runDir = join(identity.paths.reflection, "runs", "run-1")
    await mkdir(runDir, { recursive: true })
    await writeRunJsonAtomic(join(runDir, "ledger.json"), ledger())
    let completeCalls = 0
    const reservation = {
      readState: async () => ({}),
      complete: async (_runId: string, _outcome: string) => {
        completeCalls += 1
        throw new Error("must not complete an inactive run")
      },
    }

    // when
    const result = await settleReservationRun({
      identity,
      reservation,
      now: () => Date.parse("2026-08-11T10:01:00.000Z"),
    }, runDir, ledger(), { outcome: "merged" })

    // then
    expect(result.outcome).toBe("merged")
    expect(completeCalls).toBe(0)
    expect(JSON.parse(await readFile(join(runDir, "final.json"), "utf8"))).toMatchObject({
      runId: "run-1",
      outcome: "merged",
    })
    expect(JSON.parse(await readFile(
      join(identity.paths.reflection, "completions", "run-1.json"),
      "utf8",
    ))).toMatchObject({
      category: "deep",
      conversationIds: ["conversation-a"],
      outcome: "merged",
    })
  })

  test("#given an active run #when settlement is retried after completion #then complete is called exactly once", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "run-finalization-settlement-"))
    roots.push(root)
    const identity: MemoryIdentity = {
      id: "agent-test",
      safeSlug: "agent-test",
      paths: buildIdentityPaths(root, "agent-test"),
    }
    const runDir = join(identity.paths.reflection, "runs", "run-1")
    await mkdir(runDir, { recursive: true })
    await writeRunJsonAtomic(join(runDir, "ledger.json"), ledger())
    let active: ReservedRun | undefined = {
      runId: "run-1",
      request: {
        trigger: "step-count",
        conversationIds: ["conversation-a"],
        snapshots: [],
      },
    }
    let completeCalls = 0
    const reservation = {
      readState: async () => ({ ...(active === undefined ? {} : { active }) }),
      complete: async () => {
        completeCalls += 1
        active = undefined
        return { outcome: "merged" as const }
      },
    }
    const context = {
      identity,
      reservation,
      now: () => Date.parse("2026-08-11T10:01:00.000Z"),
    }

    // when
    await settleReservationRun(context, runDir, ledger(), { outcome: "merged" })
    await settleReservationRun(context, runDir, ledger(), { outcome: "merged" })

    // then
    expect(completeCalls).toBe(1)
  })

  test("#given a legacy ledger without category after settlement #when completion identity cannot be reconstructed #then no falsified record is published", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "run-finalization-settlement-"))
    roots.push(root)
    const identity: MemoryIdentity = {
      id: "agent-test",
      safeSlug: "agent-test",
      paths: buildIdentityPaths(root, "agent-test"),
    }
    const runDir = join(identity.paths.reflection, "runs", "run-1")
    await mkdir(runDir, { recursive: true })
    const legacy = { ...ledger(), category: undefined, conversationIds: undefined }
    await writeRunJsonAtomic(join(runDir, "ledger.json"), legacy)

    // when
    const settlement = settleReservationRun({
      identity,
      reservation: {
        readState: async () => ({}),
        complete: async () => { throw new Error("inactive") },
      },
      now: () => Date.parse("2026-08-11T10:01:00.000Z"),
    }, runDir, legacy, { outcome: "merged" })

    // then
    await expect(settlement).rejects.toThrow("completion identity")
    expect(Bun.file(join(identity.paths.reflection, "completions", "run-1.json")).size).toBe(0)
    expect(Bun.file(join(runDir, "final.json")).size).toBe(0)
  })
})
