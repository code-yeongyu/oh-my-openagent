import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync } from "node:fs"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { rmEfaultTolerant } from "../teardown.test-support"

import { GitMemoryRepo } from "@oh-my-opencode/memory-core"
import { OmoMemorySettingsSchema, type OmoConfig } from "@oh-my-opencode/omo-config-core"

import { REFLECTION_COMPLETION_ENTRY_TYPE, REFLECTION_LAUNCHED_ENTRY_TYPE } from "./completion"
import { resetModelPreflightCacheForTests } from "./model-preflight"
import { createRunnerHarness, type RunnerHarness } from "./runner.test-support"

// Each case drives a real supervisor, bootstrap, and model child - three spawned bun processes
// plus git work. The 5s default is a fast-machine assumption, not a budget those subprocesses
// fit on a loaded CI runner; the assertions stay event-driven with no sleeps.
setDefaultTimeout(60_000)

const harnesses: RunnerHarness[] = []
const WINDOWS_CLEANUP_RACE_CODES = new Set(["EBUSY", "ENOTEMPTY", "EPERM"])

// Killed children release their Windows file handles asynchronously, so an unretried removal here
// stalls into the next test file's budget. Retry generously, and tolerate only the platform's known
// cleanup races so every other cleanup defect still fails loudly.
async function removeRoot(root: string): Promise<void> {
  try {
    await rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 })
  } catch (error) {
    if (
      process.platform === "win32"
      && error instanceof Error
      && "code" in error
      && typeof error.code === "string"
      && WINDOWS_CLEANUP_RACE_CODES.has(error.code)
    ) return
    throw error
  }
}

afterEach(async () => {
  resetModelPreflightCacheForTests()
  await Promise.all(harnesses.splice(0).map((item) => removeRoot(item.root)))
})

async function harness(options: Parameters<typeof createRunnerHarness>[0]): Promise<RunnerHarness> {
  const created = await createRunnerHarness(options)
  harnesses.push(created)
  return created
}

async function assertWorktreesClean(item: RunnerHarness): Promise<void> {
  expect(existsSync(item.identity.paths.worktrees)).toBe(true)
  expect(await readdir(item.identity.paths.worktrees)).toEqual([])
}

describe("SenpiSubprocessRunner integration", () => {
  test("#given conflicting base and agent reflection settings #when launched #then execution uses the agent category merge and timeout", async () => {
    // given
    const memory = OmoMemorySettingsSchema.parse({
      reflection: {
        merge: "integration",
        category: "quick",
        timeout_minutes: 60,
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
    })
    expect(item.spawnCalls[0]?.hardDeadlineAt).toBe(runStartedAt + 60_000)
  }, 60_000)

  test("#given a stub child that commits in its reflection worktree #when launched #then it merges records notifies and advances the cursor", async () => {
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
    expect(item.api.renderers.map((entry) => entry.customType)).toEqual([
      "senpi-memory.reflection-completion",
      "senpi-memory.reflection-launched",
      "senpi-memory.reflection-summary",
    ])
    expect(item.notifications).toHaveLength(1)
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

  test("#given an extension-only primary and a child-visible fallback #when the primary is missing in the clean child #then reflection retries and records the fallback", async () => {
    // given
    const item = await harness({ childMode: "model-fallback" })

    // when
    const result = await item.runner.launch(item.run)

    // then
    expect(result.outcome).toBe("merged")
    expect(item.spawnCalls.map((spawn) => spawn.args[spawn.args.indexOf("--model") + 1])).toEqual([
      "extension-only/primary",
      "kimi-coding/fallback",
    ])
    expect(item.spawnCalls.map((spawn) => spawn.attempt)).toEqual([1, 2])
    expect(new Set(item.spawnCalls.map((spawn) => spawn.hardDeadlineAt)).size).toBe(1)
    expect(result.completion).toMatchObject({
      model: "kimi-coding/fallback",
      thinking: "minimal",
      outcome: "merged",
    })
    await assertWorktreesClean(item)
  }, 60_000)

  test("#given the primary model's providers are all cooling down #when the child dies with a 503 #then reflection relaunches on the next candidate and merges", async () => {
    // given
    const item = await harness({ childMode: "provider-cooldown" })

    // when
    const result = await item.runner.launch(item.run)

    // then
    expect(result.outcome).toBe("merged")
    expect(item.spawnCalls.map((spawn) => spawn.args[spawn.args.indexOf("--model") + 1])).toEqual([
      "extension-only/primary",
      "kimi-coding/fallback",
    ])
    expect(item.spawnCalls.map((spawn) => spawn.attempt)).toEqual([1, 2])
    expect(result.completion).toMatchObject({
      model: "kimi-coding/fallback",
      thinking: "minimal",
      outcome: "merged",
    })
    await assertWorktreesClean(item)
  }, 60_000)

  test("#given no candidate is visible #when a fresh probe and then its cached negative are used #then only the fresh verdict fails closed", async () => {
    // given
    const item = await harness({
      childMode: "commit",
      preflightModels: [{ provider: "other", id: "model" }],
    })

    // when
    const fresh = await item.runner.launch(item.run)
    const cached = await item.runner.launch(await item.reserveAgain())

    // then
    expect(fresh).toMatchObject({ outcome: "failed", reason: "spawn_failed" })
    expect(fresh.detail).toContain("No reflection model candidate is visible")
    expect(cached.outcome).toBe("merged")
    expect(item.spawnCalls).toHaveLength(1)
    expect(await readFile(item.preflightProbeLog, "utf8")).toBe("probe\n")
  }, 60_000)

  test("#given every child-visible candidate misses its model or auth #when the chain is exhausted #then the failed outcome fingerprints every attempted cause", async () => {
    // given
    const item = await harness({ childMode: "model-exhausted" })

    // when
    const result = await item.runner.launch(item.run)

    // then
    expect(result).toMatchObject({ outcome: "failed", reason: "spawn_failed" })
    expect(result.detail).toContain("model_not_visible:extension-only/primary")
    expect(result.detail).toContain("auth_missing:kimi-coding")
    expect(result.detail).toContain("attempted:extension-only/primary,kimi-coding/fallback")
    expect(item.spawnCalls).toHaveLength(2)
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
