import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync } from "node:fs"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { GitMemoryRepo } from "@oh-my-opencode/memory-core"

import { OmoMemorySettingsSchema, type OmoConfig } from "@oh-my-opencode/omo-config-core"

import { REFLECTION_COMPLETION_ENTRY_TYPE, REFLECTION_LAUNCHED_ENTRY_TYPE } from "./completion"
import { harness, assertWorktreesClean, cleanupRunnerHarnesses } from "./runner-integration.test-support"

// Each case drives a real supervisor, bootstrap, and model child - three spawned bun processes
// plus git work. The 5s default is a fast-machine assumption, not a budget those subprocesses
// fit on a loaded CI runner; the assertions stay event-driven with no sleeps.
setDefaultTimeout(60_000)

afterEach(cleanupRunnerHarnesses)

describe("SenpiSubprocessRunner integration", () => {
  test("#given conflicting base and agent reflection settings #when launched #then execution uses the agent category merge and timeout", async () => {
    // given
    const memory = OmoMemorySettingsSchema.parse({
      reflection: {
        merge: "integration",
        category: "quick",
        timeout_minutes: 60,
        max_concurrent_runs: 2,
      },
      agents: {
        "agent-test": {
          reflection: {
            merge: "auto",
            category: "deep",
            timeout_minutes: 1,
          },
        },
      },
    })
    const config: OmoConfig = {
      memory,
      categories: {
        quick: { model: "base/model", reasoning: "minimal" },
        deep: { model: "override/model", reasoning: "high" },
      },
    }
    const runStartedAt = Date.now()
    const item = await harness({
      childMode: "commit",
      config,
      now: () => new Date(runStartedAt),
      models: [
        { provider: "base", id: "model" },
        { provider: "override", id: "model" },
      ],
    })

    // when
    const result = await item.runner.launch(item.run)

    // then
    expect(result.outcome).toBe("merged")
    expect(item.spawnCalls[0]).toMatchObject({
      category: "deep",
      conversationIds: ["conversation-a"],
      model: "override/model",
      thinking: "high",
      mergePolicy: "auto",
      memoryRoot: item.root,
      maxConcurrentRuns: 2,
    })
    expect(item.spawnCalls[0]?.hardDeadlineAt).toBe(runStartedAt + 60_000)
  }, 60_000)

  test("#given a stub child that commits in its reflection worktree #when launched #then it merges records and advances the cursor without a toast", async () => {
    // given
    const item = await harness({ childMode: "commit" })
    const parent = new GitMemoryRepo({ dir: item.identity.paths.repo, agentId: item.identity.id })
    const headBefore = await parent.head()

    // when
    const result = await item.runner.launch(item.run)

    // then
    expect(result.outcome).toBe("merged")
    expect(await parent.head()).not.toBe(headBefore)
    expect(await readFile(join(item.identity.paths.repo, "system", "reflected.md"), "utf8")).toContain("reflection stub")
    expect((await item.journal.getState()).reflected_completed_steps).toBe(1)
    expect(item.api.entries.map((entry) => entry.customType)).toEqual([
      REFLECTION_LAUNCHED_ENTRY_TYPE,
      REFLECTION_COMPLETION_ENTRY_TYPE,
    ])
    expect(item.api.entries[0]).toEqual({
      customType: REFLECTION_LAUNCHED_ENTRY_TYPE,
      data: expect.objectContaining({
        schemaVersion: 1,
        runId: item.run.runId,
        identity: "agent-test",
        trigger: "step-count",
        category: "quick",
        conversationIds: ["conversation-a"],
        backlogSteps: 1,
      }),
    })
    expect(item.api.renderers.map((entry) => entry.customType)).toEqual(["senpi-memory.reflection-completion"])
    expect(item.notifications).toEqual([])
    expect(await readFile(item.preflightProbeLog, "utf8")).toBe("probe\n")
    expect(item.spawnCalls).toHaveLength(1)
    const spawn = item.spawnCalls[0]
    expect(spawn?.detached).toBe(true)
    expect(spawn?.cwd).toBe(spawn?.paths.worktree)
    expect(spawn?.env.MEMORY_DIR).toBe(spawn?.paths.worktree)
    expect(spawn?.env.TRANSCRIPT_PATH).toBe(spawn?.paths.transcript)
    expect(spawn?.env.SENPI_MEMORY_REFLECTION).toBe("1")
    // A detached child has no controlling terminal, so senpi's PTY-backed bash session errors
    // ("Native PTY session handle is missing write()") and the child can never git-commit; the
    // pipe fallback is the supported non-interactive path (SENPI_PTY_FORCE_PIPE in pi-pty).
    expect(spawn?.env.SENPI_PTY_FORCE_PIPE).toBe("1")
    const childArgs = [
      "-p",
      "--system-prompt", spawn?.paths.persona,
      "--tools", "bash,edit",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
      "--session-dir", spawn?.paths.sessionDir,
      "--model", "omo-mock/mock-1",
      "--thinking", "high",
      `@${spawn?.paths.prompt}`,
    ]
    expect(spawn?.args.slice(-childArgs.length)).toEqual(childArgs)
    expect(existsSync(join(spawn?.paths.sessionDir ?? "", "launch.json"))).toBe(false)
    expect(JSON.parse(await readFile(join(spawn?.paths.sessionDir ?? "", "outcome.json"), "utf8"))).toMatchObject({
      version: 1,
      runId: item.run.runId,
      childExit: { code: 0, signal: null },
      timedOut: false,
    })
    expect(JSON.parse(await readFile(join(spawn?.paths.sessionDir ?? "", "ledger.json"), "utf8"))).toMatchObject({
      version: 1,
      runId: item.run.runId,
      kind: "reflection",
      trigger: item.run.request.trigger,
      pid: expect.any(Number),
      childPid: expect.any(Number),
      deadlineAt: expect.any(Number),
      mergePolicy: "auto",
      worktreeDir: spawn?.paths.worktree,
    })
    expect(JSON.parse(await readFile(join(item.identity.paths.reflection, "completions", `${item.run.runId}.json`), "utf8"))).toMatchObject({
      runId: item.run.runId,
      outcome: "merged",
      durationMs: expect.any(Number),
      mergedCommitSha: expect.stringMatching(/^[a-f0-9]{40}$/),
      filesChanged: 1,
      consecutiveFailures: 0,
      finishedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      delivery: { status: "consumed", sessionId: "conversation-a" },
    })
    await assertWorktreesClean(item)
  }, 60_000)

  test("#given a child sleeping beyond an injected hard deadline #when launched #then the process group times out and cleanup leaves the cursor retryable", async () => {
    // given
    const item = await harness({ childMode: "timeout", deadlineMs: 100, terminationGraceMs: 25 })

    // when
    const result = await item.runner.launch(item.run)

    // then
    expect(result).toMatchObject({ outcome: "timed_out", reason: "deadline_exceeded" })
    expect((await item.journal.getState()).reflected_completed_steps).toBe(0)
    expect((await item.store.readState()).active).toBeUndefined()
    await assertWorktreesClean(item)
  }, 60_000)


  test("#given empty categories and no quick model #when launched twice in one session #then both fail without spawning and only one unsuppressed warning appears", async () => {
    // given
    const item = await harness({ childMode: "commit", categoryAvailable: false })

    // when
    const first = await item.runner.launch(item.run)
    const second = await item.runner.launch(await item.reserveAgain())

    // then
    expect(first).toMatchObject({ outcome: "failed", reason: "category_unavailable" })
    expect(second).toMatchObject({ outcome: "failed", reason: "category_unavailable" })
    expect(item.spawnCalls).toHaveLength(0)
    expect(item.api.entries.every((entry) => entry.customType !== REFLECTION_LAUNCHED_ENTRY_TYPE)).toBe(true)
    expect(item.notifications).toHaveLength(1)
    expect(item.notifications[0]?.message).toContain('Category "quick"')
    expect((await item.journal.getState()).reflected_completed_steps).toBe(0)
  }, 60_000)

  test("#given a zero-exit child that modifies linked-worktree git administration #when completion validates #then it fails cleans up and leaves the cursor unmoved", async () => {
    // given
    const item = await harness({ childMode: "admin" })

    // when
    const result = await item.runner.launch(item.run)

    // then
    expect(result).toMatchObject({ outcome: "failed", reason: "completion_validation" })
    expect(result.detail).toContain("Git administration files were modified")
    expect((await item.journal.getState()).reflected_completed_steps).toBe(0)
    await assertWorktreesClean(item)
  }, 60_000)
})
