import { afterEach, describe, expect, test } from "bun:test"
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createNodeGitExec, GitMemoryRepo } from "@oh-my-opencode/memory-core"

import { runReflectionChild } from "./spawn-supervisor"
import type { ReflectionSpawnArgs } from "./spawn-types"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

function reflectionArgs(runDir: string) {
  const payloadDir = join(runDir, "payload")
  const exec = createNodeGitExec()
  const spawnArgs: ReflectionSpawnArgs = {
    runId: "run-supervisor-stderr",
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
      branch: "reflection/run-supervisor-stderr",
      baseSha: "base-sha",
      gitFilePath: join(runDir, ".git"),
      gitFileSnapshot: "gitdir: original\n",
      commonConfigPath: join(runDir, "config"),
      commonConfigSnapshot: null,
      exec,
    },
  }
  return { payloadDir, spawnArgs }
}

async function runThrowingSupervisor(runDir: string, maxOutputBytes?: number): Promise<unknown> {
  const { payloadDir, spawnArgs } = reflectionArgs(runDir)
  await mkdir(payloadDir)
  try {
    await runReflectionChild(spawnArgs, {
      ...(maxOutputBytes === undefined ? {} : { maxOutputBytes }),
      supervisorPath: join(import.meta.dir, "__fixtures__", "supervisor-stderr-before-outcome.ts"),
    })
  } catch (error) {
    return error
  }
  return undefined
}

describe("#8095 supervisor stderr diagnostics", () => {
  test("#given a supervisor that throws before publishing an outcome #when it exits #then its stderr is retained and the failure names only the distilled cause", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "supervisor-stderr-diagnostics-"))
    roots.push(runDir)

    const thrown = await runThrowingSupervisor(runDir)

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toContain("intentional supervisor pre-child failure")
    expect((thrown as Error).message).not.toContain("diagnostic-noise")

    const supervisorStderr = await readFile(join(runDir, "supervisor-stderr.log"), "utf8")
    expect(supervisorStderr).toContain("intentional supervisor pre-child failure")
    expect(supervisorStderr).toContain("diagnostic-noise")
    await expect(access(join(runDir, "child-stderr.log"))).rejects.toThrow()
  }, 30_000)

  test("#given supervisor stderr larger than the configured output budget #when the supervisor fails #then the durable diagnostic stays bounded to a tail", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "supervisor-stderr-bounded-"))
    roots.push(runDir)

    const thrown = await runThrowingSupervisor(runDir, 256)

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toContain("intentional supervisor pre-child failure")
    expect((thrown as Error).message).not.toContain("diagnostic-noise")

    const supervisorStderr = await readFile(join(runDir, "supervisor-stderr.log"), "utf8")
    expect(supervisorStderr).toStartWith("[truncated to last 256 bytes]")
    expect(Buffer.byteLength(supervisorStderr, "utf8")).toBeLessThanOrEqual(320)
    expect(supervisorStderr).toContain("intentional supervisor pre-child failure")
    expect(supervisorStderr).not.toContain("diagnostic-noise")
  }, 30_000)
})
