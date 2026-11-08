import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createNodeGitExec, GitMemoryRepo } from "@oh-my-opencode/memory-core"
import { runReflectionChild } from "./spawn-supervisor"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

test("#given no inherited runtime switch #when launching a supervisor #then the child enters script mode", async () => {
  // given
  const root = await mkdtemp(join(tmpdir(), "supervisor-runtime-"))
  roots.push(root)
  const exec = createNodeGitExec()
  const previous = process.env.BUN_BE_BUN
  delete process.env.BUN_BE_BUN
  try {
    // when
    const run = runReflectionChild({
      runId: "runtime-probe",
      kind: "reflection",
      trigger: "step-count",
      origin: "manual",
      attempt: 1,
      hardDeadlineAt: Date.now() + 10_000,
      category: "quick",
      conversationIds: ["conversation"],
      model: "fixture/model",
      command: process.execPath,
      args: [],
      cwd: root,
      env: {},
      detached: true,
      paths: {
        sessionDir: root,
        worktree: root,
        gitCommonDir: root,
        transcript: join(root, "transcript"),
        persona: join(root, "persona"),
        prompt: join(root, "prompt"),
      },
      mergePolicy: "auto",
      worktree: {
        parent: new GitMemoryRepo({ dir: root, agentId: "agent-test", exec }),
        dir: root,
        branch: "reflection/runtime-probe",
        baseSha: "base",
        gitFilePath: join(root, ".git"),
        gitFileSnapshot: "gitdir: original\n",
        commonConfigPath: join(root, "config"),
        commonConfigSnapshot: null,
        exec,
      },
    }, { supervisorPath: join(import.meta.dir, "__fixtures__", "supervisor-runtime-env.mjs") })
    // then
    await expect(run).rejects.toThrow("memory run supervisor exited with 0")
    expect(await readFile(join(root, "runtime-mode"), "utf8")).toBe("1")
  } finally {
    if (previous === undefined) delete process.env.BUN_BE_BUN
    else process.env.BUN_BE_BUN = previous
  }
})
