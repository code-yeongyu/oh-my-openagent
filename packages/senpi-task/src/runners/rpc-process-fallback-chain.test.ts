import type { ChildProcess } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
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

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "senpi-task-rpc-fallback-"))
  tmpDirs.push(dir)
  return dir
}

function spec(taskId: string, overrides: Partial<RpcRunnerSpec> = {}): RpcRunnerSpec {
  return { task_id: taskId, cwd: process.cwd(), state_dir: tempDir(), prompt: "hello", ...overrides }
}

interface FakeEngine {
  readonly runner: RpcProcessRunner
  readonly warnings: string[]
  commands(): Array<{ readonly type: string; readonly retryFallback?: unknown }>
}

function processRunner(
  capabilities: readonly string[],
  options: { readonly retryFallback?: "refuse" | "hang" | "exit"; readonly fallbackChainDeadlineMs?: number } = {},
): FakeEngine {
  const warnings: string[] = []
  const log = join(tempDir(), "commands.jsonl")
  const runner = new RpcProcessRunner({
    // Model admission probes a real catalog (seconds on a cold Windows runner); it is not what these tests cover.
    modelAdmission: async () => {},
    onWarning: (message) => void warnings.push(message),
    ...(options.fallbackChainDeadlineMs === undefined ? {} : { fallbackChainDeadlineMs: options.fallbackChainDeadlineMs }),
    spawnChild: (descriptor) => {
      const child = spawnFakeChild({
        ...descriptor.env,
        FAKE_CAPABILITIES: capabilities.join(","),
        FAKE_COMMAND_LOG: log,
        ...(options.retryFallback === undefined ? {} : { FAKE_RETRY_FALLBACK: options.retryFallback }),
      })
      children.push(child)
      return child
    },
  })
  return {
    runner,
    warnings,
    commands: () =>
      readFileSync(log, "utf8")
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line)),
  }
}

const CHAINED = { model: "anthropic/claude-opus-5-5", fallbackModels: ["openai/gpt-5.6-sol", "kimi-coding/kimi-k3"] }

describe("a process-runner child's own fallback chain (#9582)", () => {
  test("#given an engine that takes a fallback chain #when a child with fallback models starts #then its chain is sent before its first prompt and nothing is reported", async () => {
    // given
    const engine = processRunner(["retry_fallback_command"])

    // when
    await engine.runner.start(spec("st_p1", CHAINED))

    // then
    const commands = engine.commands()
    expect(commands.map((command) => command.type)).toEqual(["get_protocol_info", "set_retry_fallback", "prompt"])
    expect(commands[1]?.retryFallback).toEqual({
      modelFallback: true,
      fallbackChains: { "anthropic/claude-opus-5-5": ["openai/gpt-5.6-sol", "kimi-coding/kimi-k3"] },
    })
    expect(engine.warnings).toEqual([])
  })

  test("#given a resumed child with fallback models #when it starts #then its chain is set before the old session is switched in", async () => {
    // given
    const engine = processRunner(["retry_fallback_command"])

    // when
    await engine.runner.start(spec("st_p2", { ...CHAINED, resumeSessionPath: join(tempDir(), "resumed.jsonl") }))

    // then
    expect(engine.commands().map((command) => command.type)).toEqual([
      "get_protocol_info",
      "set_retry_fallback",
      "switch_session",
    ])
  })

  test("#given a child without fallback models #when it starts #then the engine is sent nothing new and nothing is reported", async () => {
    // given
    const engine = processRunner(["retry_fallback_command"])

    // when
    await engine.runner.start(spec("st_p3", { model: "anthropic/claude-opus-5-5" }))

    // then
    expect(engine.commands().map((command) => command.type)).toEqual(["prompt"])
    expect(engine.warnings).toEqual([])
  })

  test("#given an older engine without the command #when two children with fallback models start #then neither is sent a chain and the user is told once", async () => {
    // given
    const engine = processRunner([])

    // when
    await engine.runner.start(spec("st_p4", CHAINED))
    await engine.runner.start(spec("st_p5", CHAINED))

    // then
    expect(engine.commands().map((command) => command.type)).not.toContain("set_retry_fallback")
    expect(engine.warnings).toHaveLength(1)
    expect(engine.warnings[0]).toContain("retry_fallback_command")
  })

  test("#given an engine that refuses the chain #when a child with fallback models starts #then it still gets its first prompt and the user is told why the chain is missing", async () => {
    // given
    const engine = processRunner(["retry_fallback_command"], { retryFallback: "refuse" })

    // when
    const handle = await engine.runner.start(spec("st_p6", CHAINED))

    // then
    await handle.waitForIdle()
    expect(handle.lastAssistantText()).toBe("hello")
    expect(engine.commands().map((command) => command.type)).toEqual(["get_protocol_info", "set_retry_fallback", "prompt"])
    expect(engine.warnings).toHaveLength(1)
    expect(engine.warnings[0]).toContain("st_p6")
    expect(engine.warnings[0]).toContain("refused")
  })

  test("#given an engine that never answers the chain #when a child with fallback models starts #then its first prompt goes out after the deadline instead of waiting forever", async () => {
    // given
    const engine = processRunner(["retry_fallback_command"], { retryFallback: "hang", fallbackChainDeadlineMs: 300 })

    // when
    const handle = await engine.runner.start(spec("st_p7", CHAINED))

    // then
    await handle.waitForIdle()
    expect(handle.lastAssistantText()).toBe("hello")
    expect(engine.commands().map((command) => command.type)).toEqual(["get_protocol_info", "set_retry_fallback", "prompt"])
    expect(engine.warnings).toHaveLength(1)
    expect(engine.warnings[0]).toContain("st_p7")
    expect(engine.warnings[0]).toContain("no answer")
  })

  test("#given a child that exits while its chain is being sent #when it starts #then the start fails on the dead child and the warning says it exited, not that the chain was refused", async () => {
    // given
    const engine = processRunner(["retry_fallback_command"], { retryFallback: "exit" })

    // when
    const started = engine.runner.start(spec("st_p8", CHAINED))

    // then
    await expect(started).rejects.toMatchObject({ failure: { kind: "child-prompt-failed", rejected_while: "exited" } })
    expect(engine.warnings).toHaveLength(1)
    expect(engine.warnings[0]).toContain("st_p8")
    expect(engine.warnings[0]).toContain("exited")
    expect(engine.warnings[0]).not.toContain("refused")
  })
})
