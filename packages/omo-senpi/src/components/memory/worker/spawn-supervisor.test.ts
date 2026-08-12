import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createNodeGitExec, GitMemoryRepo } from "@oh-my-opencode/memory-core"

import { runReflectionChild } from "./spawn-supervisor"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe("supervised child outcome authority", () => {
  test("#given a matching durable outcome and a later supervisor failure #when the parent completes #then the outcome remains authoritative", async () => {
    // given
    const runDir = await mkdtemp(join(tmpdir(), "supervisor-outcome-authority-"))
    roots.push(runDir)
    const payloadDir = join(runDir, "payload")
    await mkdir(payloadDir)
    const exec = createNodeGitExec()

    // when
    const result = await runReflectionChild({
      runId: "run-1",
      kind: "reflection",
      trigger: "step-count",
      origin: "manual",
      attempt: 1,
      hardDeadlineAt: Date.now() + 10_000,
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
        branch: "reflection/run-1",
        baseSha: "base-sha",
        gitFilePath: join(runDir, ".git"),
        gitFileSnapshot: "gitdir: original\n",
        commonConfigPath: join(runDir, "config"),
        commonConfigSnapshot: null,
        exec,
      },
    }, {
      supervisorPath: join(import.meta.dir, "__fixtures__", "supervisor-outcome-then-fail.ts"),
    })

    // then
    expect(result).toMatchObject({ code: null, signal: "SIGTERM", timedOut: true })
  }, 30_000)
})
