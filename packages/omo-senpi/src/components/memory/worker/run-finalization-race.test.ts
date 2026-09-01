import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GitMemoryRepo, buildIdentityPaths, type MemoryIdentity, type ReservedRun } from "@oh-my-opencode/memory-core"

import { abandonReservationRun, failReservationRun } from "./run-finalization"
import { writeRunJsonAtomic } from "./run-artifacts"
import { claimRunTerminal } from "./run-terminal-claim"
import type { ReservationRunLedger } from "./reservation-run-ledger"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function fixture(attempt: number) {
  const root = await mkdtemp(join(tmpdir(), "run-finalization-race-"))
  roots.push(root)
  const identity: MemoryIdentity = {
    id: "agent-test",
    safeSlug: "agent-test",
    paths: buildIdentityPaths(root, "agent-test"),
  }
  await new GitMemoryRepo({ dir: identity.paths.repo, agentId: identity.id }).init()
  const runDir = join(identity.paths.reflection, "runs", "run-1")
  await mkdir(runDir, { recursive: true })
  const ledger: ReservationRunLedger = {
    version: 1,
    runId: "run-1",
    attempt,
    category: "quick",
    conversationIds: ["conversation-a"],
    kind: "reflection",
    trigger: "step-count",
    startedAt: "2026-08-11T10:00:00.000Z",
    hardDeadlineAt: 1,
    terminationGraceMs: 1,
    deadlineAt: 2,
    mergePolicy: "auto",
    worktreeDir: join(root, "missing-worktree"),
    worktreeBranch: "memory/reflection-missing",
    baseSha: await new GitMemoryRepo({ dir: identity.paths.repo, agentId: identity.id }).head() ?? "",
    gitFilePath: join(root, "missing-worktree", ".git"),
    gitFileSnapshot: "gitdir: missing\n",
    commonConfigPath: join(identity.paths.repo, ".git", "config"),
    commonConfigSnapshot: null,
  }
  await writeRunJsonAtomic(join(runDir, "ledger.json"), ledger)
  const active: ReservedRun = {
    runId: "run-1",
    request: {
      trigger: "step-count",
      conversationIds: ["conversation-a"],
      snapshots: [],
    },
  }
  return { identity, runDir, ledger, active }
}

describe("run finalization publication races", () => {
  test("#given outcome publishes during abandonment state read #when terminalized #then matching outcome wins and abandoned is never published", async () => {
    // given
    const item = await fixture(1)
    let completeOutcome: string | undefined
    let published = false
    const reservation = {
      readState: async () => {
        if (!published) {
          published = true
          await writeRunJsonAtomic(join(item.runDir, "outcome.json"), {
            version: 1,
            runId: "run-1",
            attempt: 1,
            finishedAt: "2026-08-11T10:00:01.000Z",
            childExit: { code: null, signal: "SIGTERM" },
            timedOut: true,
          })
        }
        return { active: item.active }
      },
      complete: async (_runId: string, outcome: "failed" | "timed_out") => {
        completeOutcome = outcome
        return { outcome }
      },
    }

    // when
    const result = await abandonReservationRun({
      identity: item.identity,
      reservation,
      now: () => Date.parse("2026-08-11T10:01:00.000Z"),
    }, item.runDir, item.ledger)

    // then
    expect(result?.outcome).toBe("timed_out")
    expect(completeOutcome).toBe("timed_out")
    expect(existsSync(join(item.runDir, "abandoned.json"))).toBe(false)
  }, 30_000)

  test("#given publication is scheduled after every unknown-liveness read #when abandonment writes #then the matching publisher wins atomically", async () => {
    // given
    const item = await fixture(1)
    const ledger = { ...item.ledger, pid: 424242, processStart: null }
    await writeRunJsonAtomic(join(item.runDir, "ledger.json"), ledger)
    let publication: Promise<void> | undefined
    const reservation = {
      readState: async () => ({ active: item.active }),
      complete: async (_runId: string, outcome: "failed") => ({ outcome }),
    }

    // when
    const result = await abandonReservationRun({
      identity: item.identity,
      reservation,
      now: () => Date.parse("2026-08-11T10:01:00.000Z"),
      getPidLiveness: () => {
        publication ??= (async () => {
          await claimRunTerminal(item.runDir, { runId: ledger.runId, attempt: ledger.attempt ?? 1 }, "publish")
          await new Promise<void>((resolve) => setImmediate(resolve))
          await writeRunJsonAtomic(join(item.runDir, "publishing.json"), {
            version: 1,
            runId: "run-1",
            attempt: 1,
            finishedAt: "2026-08-11T10:00:01.000Z",
          })
        })()
        return "unknown"
      },
    }, item.runDir, ledger)
    await publication

    // then
    expect(result).toBeUndefined()
    expect(existsSync(join(item.runDir, "abandoned.json"))).toBe(false)
  }, 30_000)

  test("#given attempt two and a stale attempt-one outcome #when current attempt is confirmed dead #then stale outcome is ignored", async () => {
    // given
    const item = await fixture(2)
    await writeRunJsonAtomic(join(item.runDir, "outcome.json"), {
      version: 1,
      runId: "run-1",
      attempt: 1,
      finishedAt: "2026-08-11T10:00:01.000Z",
      childExit: { code: 1, signal: null },
      timedOut: false,
    })
    let completeCalls = 0
    const reservation = {
      readState: async () => ({ active: item.active }),
      complete: async (_runId: string, outcome: "failed") => {
        completeCalls += 1
        return { outcome }
      },
    }

    // when
    const result = await failReservationRun({
      identity: item.identity,
      reservation,
      now: () => Date.parse("2026-08-11T10:01:00.000Z"),
    }, item.runDir, item.ledger, "failed")

    // then
    expect(result?.outcome).toBe("failed")
    expect(completeCalls).toBe(1)
    expect(JSON.parse(await Bun.file(join(item.runDir, "final.json")).text())).toMatchObject({
      outcome: "failed",
    })
  }, 30_000)
})
