import { expect, test } from "bun:test"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { acquireReflectionRunLease, GitMemoryRepo } from "@oh-my-opencode/memory-core"
import { slotHarness } from "./supervisor-slot.test-support"
import { runReflectionChild } from "./spawn-supervisor"

test("the real parent waits beyond its original deadline while the supervisor queues", async () => {
  const harness = await slotHarness()
  const holder = await acquireReflectionRunLease(harness.locks)
  let completion: ReturnType<typeof runReflectionChild> | undefined
  try {
    const run = await harness.makeRun("parent-waiter")
    const queuedAt = Date.now() - 60_000
    const queued = harness.waitQueued(1)
    completion = runReflectionChild({
      runId: run.id, attempt: 1, category: "quick", conversationIds: [], model: "fixture/model",
      kind: "reflection", trigger: "manual", mergePolicy: "auto", detached: true,
      hardDeadlineAt: queuedAt + 10_000, memoryRoot: harness.root,
      command: run.manifest.command, args: run.manifest.args, cwd: harness.root, env: run.manifest.env,
      worktree: {
        parent: new GitMemoryRepo({ dir: run.paths.repo, agentId: run.id }),
        dir: run.paths.repo, branch: "fixture", baseSha: "fixture",
        gitFilePath: join(run.paths.repo, ".git"), gitFileSnapshot: "",
        commonConfigPath: join(run.paths.repo, "config"), commonConfigSnapshot: null,
        exec: { run: async () => { throw new Error("spawn must not run git") } },
      },
      paths: {
        sessionDir: run.runDir, worktree: run.paths.repo, gitCommonDir: run.paths.repo,
        transcript: "", persona: "", prompt: "",
      },
    }, {
      now: () => queuedAt,
      supervisorPath: fileURLToPath(new URL("./memory-run-supervisor.ts", import.meta.url)),
    })
    // Observe rejection immediately; the assertion below still awaits the original result.
    void completion.catch(() => undefined)
    await queued
    const started = harness.waitStarted(run.id)
    await holder.release()
    await started
    harness.release(run.id)
    expect(await completion).toMatchObject({ code: 0, timedOut: false })
  } finally {
    await holder.release()
    harness.flow()
    if (completion !== undefined) await Promise.allSettled([completion])
    await harness.cleanup()
  }
}, 60_000)
