import type { ChildProcess } from "node:child_process"
import { EventEmitter, once } from "node:events"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough, Writable } from "node:stream"
import { setImmediate } from "node:timers/promises"
import { afterEach, describe, expect, jest, test } from "bun:test"

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

// A real Writable keeps commands FIFO while a held write callback simulates pipe backpressure.
// Only the engine's responses and write completion are controlled; the runner/client are real.
function controlledEngine(options: { readonly holdProtocol?: boolean; readonly holdChainWrite?: boolean } = {}) {
  const stdout = new PassThrough()
  const events = new EventEmitter()
  const commands: string[] = []
  const warnings: string[] = []
  let protocol: { id: string; type: string } | undefined
  let releaseChain: (() => void) | undefined
  const reply = (command: { id: string; type: string }, data?: unknown): void => {
    stdout.write(`${JSON.stringify({ type: "response", id: command.id, command: command.type, success: true, data })}\n`)
  }
  const replyProtocol = (): void => {
    if (protocol === undefined) throw new Error("capability probe has not arrived")
    reply(protocol, { capabilities: ["retry_fallback_command"] })
  }
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      const command = JSON.parse(String(chunk)) as { id: string; type: string }
      const accept = (): void => {
        commands.push(command.type)
        if (command.type === "get_protocol_info") {
          protocol = command
          if (!options.holdProtocol) replyProtocol()
        } else if (command.type !== "set_retry_fallback") {
          reply(command, command.type === "switch_session" ? { cancelled: false } : undefined)
        }
        callback()
      }
      if (command.type === "set_retry_fallback" && options.holdChainWrite) releaseChain = accept
      else accept()
      events.emit(command.type)
    },
  })
  const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr: new PassThrough() }) as unknown as ChildProcess
  const runner = new RpcProcessRunner({
    modelAdmission: async () => {},
    spawnChild: () => child,
    fallbackChainDeadlineMs: 300,
    onWarning: (message) => {
      warnings.push(message)
      events.emit("warning")
    },
  })
  return {
    runner, commands, warnings, replyProtocol,
    next: (event: string) => once(events, event, { signal: AbortSignal.timeout(5_000) }).catch((error) => {
      throw new Error(`waited 5s for RPC engine event '${event}', never fired`, { cause: error })
    }),
    releaseChain: () => {
      if (releaseChain === undefined) throw new Error("chain write has not arrived")
      releaseChain()
    },
    close: () => {
      child.emit("close", 0, null)
      stdin.destroy()
      stdout.destroy()
      child.stderr?.destroy()
    },
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

  test("#given a held chain write and no reply #when its deadline fires #then the prompt remains behind the chain in the pipe", async () => {
    jest.useFakeTimers()
    const engine = controlledEngine({ holdProtocol: true, holdChainWrite: true })
    try {
      // given: arm before starting; advancing time never depends on a subprocess booting quickly.
      const probe = engine.next("get_protocol_info")
      const chainWrite = engine.next("set_retry_fallback")
      const warning = engine.next("warning")
      const started = engine.runner.start(spec("st_p7", CHAINED))
      await probe
      await setImmediate()
      jest.advanceTimersByTime(100)
      engine.replyProtocol()
      await chainWrite
      await setImmediate()

      // when: the remaining shared budget elapses while Writable is still blocked on the chain.
      jest.advanceTimersByTime(200)
      await warning
      await setImmediate()
      expect(engine.commands).toEqual(["get_protocol_info"])
      engine.releaseChain()
      await started

      // then: the queued prompt cannot overtake the chain, even though its write completed late.
      expect(engine.commands).toEqual(["get_protocol_info", "set_retry_fallback", "prompt"])
      expect(engine.warnings).toHaveLength(1)
      expect(engine.warnings[0]).toContain("st_p7")
      expect(engine.warnings[0]).toContain("no answer")
    } finally {
      engine.close()
      jest.useRealTimers()
    }
  })

  test.each([false, true])("#given a late capability reply (resume=%s) #when setup times out #then no chain is sent after work starts", async (resume) => {
    jest.useFakeTimers()
    const engine = controlledEngine({ holdProtocol: true })
    try {
      // given
      const probe = engine.next("get_protocol_info")
      const started = engine.runner.start(spec("st_late", {
        ...CHAINED,
        ...(resume ? { resumeSessionPath: join(tempDir(), "resumed.jsonl") } : {}),
      }))
      await probe
      await setImmediate()

      // when: first work is released before the held probe answer arrives.
      jest.advanceTimersByTime(300)
      await started
      engine.replyProtocol()
      await setImmediate()

      // then: settling an abandoned read must never write launch-time configuration afterward.
      expect(engine.commands).toEqual(["get_protocol_info", resume ? "switch_session" : "prompt"])
      expect(engine.warnings).toHaveLength(1)
      expect(engine.warnings[0]).toContain("st_late")
      expect(engine.warnings[0]).toContain("no answer")
    } finally {
      engine.close()
      jest.useRealTimers()
    }
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
