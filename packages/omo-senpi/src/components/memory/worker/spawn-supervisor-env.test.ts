import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createNodeGitExec, GitMemoryRepo } from "@oh-my-opencode/memory-core"

import { runReflectionChild } from "./spawn-supervisor"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe("supervisor spawn environment", () => {
  test("#given a packaged omo binary as execPath #when the supervisor is spawned #then BUN_BE_BUN forces Bun runtime mode", async () => {
    // given
    const runDir = await mkdtemp(join(tmpdir(), "supervisor-env-probe-"))
    roots.push(runDir)
    const payloadDir = join(runDir, "payload")
    await mkdir(payloadDir)
    const exec = createNodeGitExec()
    const previous = process.env.BUN_BE_BUN
    delete process.env.BUN_BE_BUN

    try {
      // when
      const run = runReflectionChild({
        runId: "run-env-probe",
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
          branch: "reflection/run-env-probe",
          baseSha: "base-sha",
          gitFilePath: join(runDir, ".git"),
          gitFileSnapshot: "gitdir: original\n",
          commonConfigPath: join(runDir, "config"),
          commonConfigSnapshot: null,
          exec,
        },
      }, {
        supervisorPath: join(import.meta.dir, "__fixtures__", "supervisor-env-probe.ts"),
      })

      // then: the probe supervisor exits 0 without an outcome, and the probe file proves the env
      await expect(run).rejects.toThrow("memory run supervisor exited with 0")
      const probe = JSON.parse(await readFile(join(runDir, "env-probe.json"), "utf8")) as {
        bunBeBun: string | null
      }
      expect(probe.bunBeBun).toBe("1")
    } finally {
      if (previous === undefined) delete process.env.BUN_BE_BUN
      else process.env.BUN_BE_BUN = previous
    }
  }, 30_000)
})
