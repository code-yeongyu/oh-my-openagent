import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createNodeGitExec, GitMemoryRepo } from "@oh-my-opencode/memory-core"

import { runReflectionChild } from "./spawn-supervisor"
import { waitForRunSentinel } from "./run-sentinel"

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

  test("#given an outcome before launch cleanup and a supervisor failure #when the parent completes #then the incomplete outcome is rejected", async () => {
    // given
    const runDir = await mkdtemp(join(tmpdir(), "supervisor-incomplete-outcome-"))
    roots.push(runDir)
    const payloadDir = join(runDir, "payload")
    await mkdir(payloadDir)
    const exec = createNodeGitExec()

    // when
    const run = runReflectionChild({
      runId: "run-incomplete",
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
        branch: "reflection/run-incomplete",
        baseSha: "base-sha",
        gitFilePath: join(runDir, ".git"),
        gitFileSnapshot: "gitdir: original\n",
        commonConfigPath: join(runDir, "config"),
        commonConfigSnapshot: null,
        exec,
      },
    }, {
      supervisorPath: join(import.meta.dir, "__fixtures__", "supervisor-incomplete-outcome-then-fail.ts"),
    })

    // then
    await expect(run).rejects.toThrow("memory run supervisor exited with 1")
  }, 30_000)

  test("#given a matching durable outcome while the supervisor stays alive #when the parent completes #then the outcome wins without waiting for close", async () => {
    // given
    const runDir = await mkdtemp(join(tmpdir(), "supervisor-outcome-linger-"))
    roots.push(runDir)
    const payloadDir = join(runDir, "payload")
    await mkdir(payloadDir)
    const exec = createNodeGitExec()

    // when
    const result = await runReflectionChild({
      runId: "run-linger",
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
        branch: "reflection/run-linger",
        baseSha: "base-sha",
        gitFilePath: join(runDir, ".git"),
        gitFileSnapshot: "gitdir: original\n",
        commonConfigPath: join(runDir, "config"),
        commonConfigSnapshot: null,
        exec,
      },
    }, {
      supervisorPath: join(import.meta.dir, "__fixtures__", "supervisor-outcome-then-linger.ts"),
    })
    await writeFile(join(runDir, "release"), "")
    expect(await waitForRunSentinel(join(runDir, "released.json"), Date.now() + 5_000, Date.now)).toBe("present")

    // then
    expect(result).toMatchObject({ code: 0, signal: null, timedOut: false })
  }, 5_000)

  test("#given a supervisor that never publishes #when the parent deadline expires #then publication timeout is reported", async () => {
    // given
    const runDir = await mkdtemp(join(tmpdir(), "supervisor-no-outcome-"))
    roots.push(runDir)
    const payloadDir = join(runDir, "payload")
    await mkdir(payloadDir)
    const exec = createNodeGitExec()

    // when
    const run = runReflectionChild({
      runId: "run-no-outcome",
      kind: "reflection",
      trigger: "step-count",
      origin: "manual",
      attempt: 1,
      hardDeadlineAt: Date.now() - 5_000,
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
        branch: "reflection/run-no-outcome",
        baseSha: "base-sha",
        gitFilePath: join(runDir, ".git"),
        gitFileSnapshot: "gitdir: original\n",
        commonConfigPath: join(runDir, "config"),
        commonConfigSnapshot: null,
        exec,
      },
    }, {
      supervisorPath: join(import.meta.dir, "__fixtures__", "supervisor-never-publishes.ts"),
    })

    // then
    try {
      await expect(run).rejects.toThrow("memory run supervisor did not publish an outcome before its deadline")
    } finally {
      await writeFile(join(runDir, "release"), "")
      expect(await waitForRunSentinel(join(runDir, "released.json"), Date.now() + 5_000, Date.now)).toBe("present")
    }
  }, 30_000)
})
