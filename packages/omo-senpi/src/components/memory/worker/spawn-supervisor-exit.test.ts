import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  acquireLock,
  createLockRecord,
  createNodeGitExec,
  getPidLiveness,
  GitMemoryRepo,
  receiptsLockPath,
  releaseLock,
} from "@oh-my-opencode/memory-core"

import { probeUntil, readPidFileWhenWritten } from "./process-liveness.test-support"
import { runReflectionChild, SUPERVISOR_EXIT_PREFIX } from "./spawn-supervisor"
import { remainingTestTime } from "../../../../../../test-support/test-deadline"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe("supervised child exit subscription", () => {
  test("#given a supervisor that exits while the launch receipt is still being written #when the parent completes #then the exit is reported", async () => {
    // given
    const runDir = await mkdtemp(join(tmpdir(), "supervisor-early-exit-"))
    roots.push(runDir)
    const payloadDir = join(runDir, "payload")
    const receiptsDir = join(runDir, "runtime")
    const receiptsLock = receiptsLockPath(join(receiptsDir, "locks"))
    await mkdir(payloadDir)
    await mkdir(join(receiptsDir, "locks"), { recursive: true })
    const exec = createNodeGitExec()
    // The launch receipt is written under this lock, so holding it keeps the parent inside that write.
    const held = await createLockRecord("receipts")
    await acquireLock(receiptsLock, held)

    // when
    const run = runReflectionChild(
      {
        runId: "run-early-exit",
        kind: "reflection",
        trigger: "step-count",
        origin: "manual",
        attempt: 1,
        hardDeadlineAt: Date.now() - 20_000,
        category: "quick",
        conversationIds: ["conversation-a"],
        model: "fixture/model",
        command: process.execPath,
        args: [],
        cwd: runDir,
        env: {},
        detached: true,
        paths: {
          sessionDir: runDir,
          worktree: runDir,
          gitCommonDir: runDir,
          transcript: join(payloadDir, "transcript.jsonl"),
          persona: join(payloadDir, "persona.md"),
          prompt: join(payloadDir, "prompt.md"),
        },
        mergePolicy: "auto",
        worktree: {
          parent: new GitMemoryRepo({ dir: runDir, agentId: "agent-test", exec }),
          dir: runDir,
          branch: "reflection/run-early-exit",
          baseSha: "base-sha",
          gitFilePath: join(runDir, ".git"),
          gitFileSnapshot: "gitdir: original\n",
          commonConfigPath: join(runDir, "config"),
          commonConfigSnapshot: null,
          exec,
        },
      },
      {
        supervisorPath: join(import.meta.dir, "__fixtures__", "supervisor-exits-unpublished.ts"),
        receiptsDir,
      },
    )
    const settled = run.then(
      () => "resolved",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    )
    const supervisorPid = await readPidFileWhenWritten(join(runDir, "supervisor.pid"), remainingTestTime())
    const exited = await probeUntil(() => getPidLiveness(supervisorPid) === "dead", remainingTestTime())
    await releaseLock(receiptsLock, held)

    // then
    expect(exited).toBe(true)
    expect(await settled).toBe(`${SUPERVISOR_EXIT_PREFIX} 3`)
  })
})
