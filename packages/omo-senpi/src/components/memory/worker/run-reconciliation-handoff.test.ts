import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths, type MemoryIdentity, type ReflectionOutcome } from "@oh-my-opencode/memory-core"

import type { ReservationStatePort } from "./run-finalization"
import { reconcileReflectionRuns } from "./run-reconciliation"
import { writeRunJsonAtomic } from "./run-artifacts"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe("retry handoff reconciliation", () => {
  test("#given attempt one is being watched #when its outcome publishes after attempt two starts launching #then the retry remains active", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "reflection-handoff-"))
    roots.push(root)
    const identity: MemoryIdentity = {
      id: "agent-test",
      safeSlug: "agent-test",
      paths: buildIdentityPaths(root, "agent-test"),
    }
    const runDir = join(identity.paths.reflection, "runs", "run-handoff")
    await mkdir(runDir, { recursive: true })
    const ledger = {
      version: 1 as const,
      runId: "run-handoff",
      attempt: 1,
      model: "extension-only/primary",
      kind: "reflection" as const,
      trigger: "step-count" as const,
      pid: 222,
      processStart: "supervisor-one",
      startedAt: "2026-08-10T00:00:00.000Z",
      hardDeadlineAt: 1_000,
      terminationGraceMs: 100,
      deadlineAt: 1_100,
      mergePolicy: "auto" as const,
      worktreeDir: join(root, "worktree"),
      worktreeBranch: "reflection/run-handoff",
      baseSha: "base-sha",
      gitFilePath: join(root, "git-file"),
      gitFileSnapshot: "gitdir: original\n",
      commonConfigPath: join(root, "config"),
      commonConfigSnapshot: null,
    }
    await writeRunJsonAtomic(join(runDir, "ledger.json"), ledger)
    let completed: ReflectionOutcome | undefined
    const reservation: ReservationStatePort = {
      readState: async () => ({}),
      complete: async (_runId, outcome) => {
        completed = outcome
        return { outcome }
      },
    }

    // when
    const results = await reconcileReflectionRuns({
      identity,
      reservation,
      now: () => 500,
      getPidLiveness: () => "alive",
      getProcessStartIdentity: async () => "supervisor-one",
      waitForOutcome: async (outcomePath) => {
        await writeRunJsonAtomic(join(runDir, "ledger.json"), {
          ...ledger,
          attempt: 2,
          model: "omo-mock/mock-1",
          launching: true,
          pid: undefined,
          processStart: undefined,
        })
        await writeRunJsonAtomic(outcomePath, {
          version: 1,
          runId: "run-handoff",
          attempt: 1,
          finishedAt: "2026-08-10T00:00:01.000Z",
          childExit: { code: 1, signal: null },
          timedOut: false,
        })
        return "present"
      },
    })

    // then
    expect(results).toEqual([])
    expect(completed).toBeUndefined()
    expect(Bun.file(join(runDir, "abandoned.json")).size).toBe(0)
  })
})
