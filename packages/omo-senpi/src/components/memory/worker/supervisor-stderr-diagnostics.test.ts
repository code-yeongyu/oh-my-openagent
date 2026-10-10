import { afterEach, describe, expect, test } from "bun:test"
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
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


describe("supervisor stderr cause shapes", () => {
  test("#given multibyte stderr crossing the capture boundary #when sealed #then valid text stays within the byte budget", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "supervisor-utf8-tail-"))
    roots.push(runDir)
    const stderr = `Error: unicode diagnostic\n${"界".repeat(100)}`
    const thrown = await runScriptedSupervisor(runDir, stderr, 1, 256)
    expect((thrown as Error).message).toContain("unicode diagnostic")
    const stored = await readFile(join(runDir, "supervisor-stderr.log"), "utf8")
    const marker = "[truncated to last 256 bytes]\n"
    expect(stored.startsWith(marker)).toBe(true)
    expect(Buffer.byteLength(stored)).toBeLessThanOrEqual(Buffer.byteLength(marker) + 256)
    expect(stored).not.toContain("\ufffd")
  })

  test("#given diagnostics cannot be read or sealed #when the supervisor exits #then its original exit classification survives", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "supervisor-diagnostic-io-"))
    roots.push(runDir)
    const { payloadDir, spawnArgs } = reflectionArgs(runDir)
    await mkdir(payloadDir)
    const supervisorPath = join(runDir, "unreadable-supervisor.mjs")
    await writeFile(supervisorPath, `import { closeSync, mkdirSync, unlinkSync } from "node:fs"; import { join } from "node:path"; const log = join(process.argv[2], "supervisor-stderr.log"); closeSync(2); unlinkSync(log); mkdirSync(log); process.exit(1);\n`)
    const thrown = await runReflectionChild(spawnArgs, { supervisorPath }).catch((error: unknown) => error)
    expect((thrown as Error).message).toBe("memory run supervisor exited with 1")
  })

  test.each([
    ["Error: standard supervisor failure\n", "standard supervisor failure"],
    ["\u001b[31mTypeError: colored supervisor failure\u001b[0m\n", "colored supervisor failure"],
    ["ENOENT: supervisor resource is missing\n", "supervisor resource is missing"],
  ])("#given %j #when the supervisor exits before an outcome #then the failure includes %j", async (stderr, cause) => {
    const runDir = await mkdtemp(join(tmpdir(), "supervisor-cause-shape-"))
    roots.push(runDir)
    const thrown = await runScriptedSupervisor(runDir, stderr, 1)

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toContain(cause)
    expect((thrown as Error).message).not.toContain("\u001b")
    expect(await readFile(join(runDir, "supervisor-stderr.log"), "utf8")).toBe(stderr)
    if (process.platform !== "win32") {
      expect((await stat(join(runDir, "supervisor-stderr.log"))).mode & 0o777).toBe(0o600)
    }
    await expect(access(join(runDir, "outcome.json"))).rejects.toThrow()
    await expect(access(join(runDir, "child-stderr.log"))).rejects.toThrow()
  })

  test.each([0, 1])("#given only non-cause stderr and exit %i #when no outcome exists #then raw code and noise stay local", async (code) => {
    const runDir = await mkdtemp(join(tmpdir(), "supervisor-no-cause-"))
    roots.push(runDir)
    const stderr = 'const privateSource = "raw code frame"\n  at launch (private.ts:1:2)\n'
    const thrown = await runScriptedSupervisor(runDir, stderr, code)

    expect((thrown as Error).message).toBe(`memory run supervisor exited with ${code}`)
    expect(await readFile(join(runDir, "supervisor-stderr.log"), "utf8")).toBe(stderr)
  })

  test("#given a real throwing supervisor #when it crashes #then raw stack stays local and its cause is surfaced", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "supervisor-real-throw-"))
    roots.push(runDir)
    const { payloadDir, spawnArgs } = reflectionArgs(runDir)
    await mkdir(payloadDir)
    const supervisorPath = join(runDir, "throwing-supervisor.mjs")
    await writeFile(supervisorPath, 'throw new Error("real supervisor launch failure")\n')
    const thrown = await runReflectionChild(spawnArgs, { supervisorPath }).catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toContain("real supervisor launch failure")
    expect((thrown as Error).message).not.toMatch(/\n|\bat .*\.mjs:/)
    const stderr = await readFile(join(runDir, "supervisor-stderr.log"), "utf8")
    expect(stderr).toContain("real supervisor launch failure")
    expect(stderr).toContain("throwing-supervisor.mjs")
  })
})

async function runScriptedSupervisor(runDir: string, stderr: string, code: number, maxOutputBytes?: number): Promise<unknown> {
  const { payloadDir, spawnArgs } = reflectionArgs(runDir)
  await mkdir(payloadDir)
  const supervisorPath = join(runDir, "supervisor.mjs")
  await writeFile(supervisorPath, `import { writeSync } from "node:fs"; writeSync(2, ${JSON.stringify(stderr)}); process.exit(${code});\n`)
  return runReflectionChild(spawnArgs, { supervisorPath, maxOutputBytes }).catch((error: unknown) => error)
}
