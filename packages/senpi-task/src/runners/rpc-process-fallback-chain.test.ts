import type { ChildProcess } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { spawnFakeChild } from "./rpc/__fixtures__/spawn-fake"
import { terminateRpcChild } from "./rpc/terminate"
import { RpcProcessRunner } from "./rpc-process"
import type { RpcRunnerSpec } from "./types"

const children: ChildProcess[] = []
const tmpDirs: string[] = []

afterEach(async () => {
  for (const child of children.splice(0)) await terminateRpcChild(child, { sigkillDelayMs: 200 })
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function spec(taskId: string, overrides: Partial<RpcRunnerSpec> = {}): RpcRunnerSpec {
  const stateDir = mkdtempSync(join(tmpdir(), "senpi-task-rpc-fallback-"))
  tmpDirs.push(stateDir)
  return { task_id: taskId, cwd: process.cwd(), state_dir: stateDir, prompt: "hello", ...overrides }
}

function runnerWithWarnings(): { readonly runner: RpcProcessRunner; readonly warnings: string[] } {
  const warnings: string[] = []
  const runner = new RpcProcessRunner({
    onWarning: (message) => void warnings.push(message),
    spawnChild: (descriptor) => {
      const child = spawnFakeChild(descriptor.env)
      children.push(child)
      return child
    },
  })
  return { runner, warnings }
}

// The per-child process runner has no way to hand a separate `senpi --mode rpc` process an in-memory
// fallback chain (#9512), so it must say so instead of silently running the child without it.
describe("a process-runner child's fallback chain (#9512)", () => {
  test("#given two children with fallback models #when the process runner starts them #then the user is told once that their chain is not applied", async () => {
    // given
    const { runner, warnings } = runnerWithWarnings()

    // when
    await runner.start(spec("st_p1", { fallbackModels: ["openai/gpt-5.6-sol"] }))
    await runner.start(spec("st_p2", { fallbackModels: ["openai/gpt-5.6-sol"] }))

    // then
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("fallback")
  })

  test("#given a child without fallback models #when the process runner starts it #then nothing is reported", async () => {
    // given
    const { runner, warnings } = runnerWithWarnings()

    // when
    await runner.start(spec("st_p3"))

    // then
    expect(warnings).toEqual([])
  })
})
