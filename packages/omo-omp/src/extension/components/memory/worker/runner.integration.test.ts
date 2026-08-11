import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { readFile, readdir, rm } from "node:fs/promises"
import { join } from "node:path"

import { GitMemoryRepo } from "@oh-my-opencode/memory-core"

import { REFLECTION_COMPLETION_ENTRY_TYPE } from "./completion"
import { createRunnerHarness, type RunnerHarness } from "./runner.test-support"

const harnesses: RunnerHarness[] = []
afterEach(async () => Promise.all(harnesses.splice(0).map((item) => rm(item.root, { recursive: true, force: true }))))

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
    expect(item.api.entries.map((entry) => entry.customType)).toEqual([REFLECTION_COMPLETION_ENTRY_TYPE])
    expect(item.api.renderers.map((entry) => entry.customType)).toEqual([REFLECTION_COMPLETION_ENTRY_TYPE])
    expect(item.notifications).toHaveLength(1)
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
    expect(spawn?.args).toEqual([
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
    ])
    expect(JSON.parse(await readFile(join(item.identity.paths.reflection, "completions", `${item.run.runId}.json`), "utf8"))).toMatchObject({
      runId: item.run.runId,
      outcome: "merged",
      finishedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      delivery: { status: "consumed", sessionId: "conversation-a" },
    })
    await assertWorktreesClean(item)
  })

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
  })

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
    expect(item.notifications).toHaveLength(1)
    expect(item.notifications[0]?.message).toContain('Category "quick"')
    expect((await item.journal.getState()).reflected_completed_steps).toBe(0)
  })

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
  })
})
