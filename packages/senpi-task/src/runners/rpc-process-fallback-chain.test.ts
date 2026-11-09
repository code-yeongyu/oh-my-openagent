import type { ChildProcess } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { afterEach, describe, expect, test } from "bun:test"

import { cleanupProjects, launchSettled, makeManager } from "../manager/__fixtures__/manager-fakes"
import { refusingProcessRunner, taskEvents } from "../manager/__fixtures__/refusing-process-runner"
import { createRpcManagedRunner } from "../manager/runner"
import type { ChildPlanner } from "../manager/types"
import type { ResolvedModelRecord } from "../state"
import { spawnFakeChild } from "./rpc/__fixtures__/spawn-fake"
import { fakeClock } from "./rpc/__fixtures__/clock"
import { terminateRpcChild } from "./rpc/terminate"
import { RpcProcessRunner } from "./rpc-process"
import type { RpcRunnerSpec } from "./types"

const children: ChildProcess[] = []
const runners: RpcProcessRunner[] = []
const tmpDirs: string[] = []

afterEach(async () => {
  await Promise.all(runners.splice(0).map((runner) => runner.settleTeardowns()))
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      await terminateRpcChild(child, { sigkillDelayMs: 200 })
    }
  }
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  cleanupProjects()
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
  commands(): Array<{ readonly type: string; readonly retryFallback?: unknown }>
  waitForCommand(type: string): Promise<void>
}

function processRunner(
  capabilities: readonly string[],
  options: {
    readonly retryFallback?: "refuse" | "hang" | "exit"
    readonly protocolInfo?: "after-prompt" | "no-data"
    readonly fallbackChainDeadlineMs?: number
  } = {},
): FakeEngine {
  const log = join(tempDir(), "commands.jsonl")
  const received = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>()
  const receipt = (type: string) => {
    const existing = received.get(type)
    if (existing !== undefined) return existing
    const pending = Promise.withResolvers<void>()
    received.set(type, pending)
    return pending
  }
  const runner = new RpcProcessRunner({
    // Model admission probes a real catalog (seconds on a cold Windows runner); it is not what these tests cover.
    modelAdmission: async () => {},
    ...(options.fallbackChainDeadlineMs === undefined ? {} : { fallbackChainDeadlineMs: options.fallbackChainDeadlineMs }),
    spawnChild: (descriptor) => {
      const child = spawnFakeChild({
        ...descriptor.env,
        FAKE_CAPABILITIES: capabilities.join(","),
        FAKE_COMMAND_LOG: log,
        FAKE_ACK_COMMAND: "1",
        ...(options.retryFallback === undefined ? {} : { FAKE_RETRY_FALLBACK: options.retryFallback }),
        ...(options.protocolInfo === undefined ? {} : { FAKE_PROTOCOL_INFO: options.protocolInfo }),
      })
      children.push(child)
      if (child.stdout === null) throw new Error("fake child stdout was not piped")
      createInterface({ input: child.stdout }).on("line", (line) => {
        const event: { readonly type?: string; readonly name?: string } = JSON.parse(line)
        if (event.type === "session_info_changed" && event.name?.startsWith("command:")) {
          receipt(event.name.slice("command:".length)).resolve()
        }
      })
      return child
    },
  })
  runners.push(runner)
  return {
    runner,
    waitForCommand: (type) => receipt(type).promise,
    commands: () =>
      readFileSync(log, "utf8")
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line)),
  }
}

const CHAINED = { model: "anthropic/claude-opus-5-5", fallbackModels: ["openai/gpt-5.6-sol", "kimi-coding/kimi-k3"] }

describe("a process-runner child's own fallback chain (#9582)", () => {
  test("#given an engine that takes a fallback chain #when a child with fallback models starts #then its chain is sent before its first prompt", async () => {
    // given
    const engine = processRunner(["retry_fallback_command"])

    // when
    await engine.runner.start(spec("st_p1", CHAINED))

    // then
    const commands = engine.commands()
    expect(commands.map((command) => command.type)).toEqual(["get_protocol_info", "set_retry_fallback", "prompt"])
    expect(commands[1]?.retryFallback).toEqual({
      modelFallback: true,
      fallbackChains: {
        "anthropic/claude-opus-5-5": ["openai/gpt-5.6-sol", "kimi-coding/kimi-k3"],
        "openai/gpt-5.6-sol": [],
        "kimi-coding/kimi-k3": [],
      },
    })
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

  test("#given a child designated one model #when it starts #then fallback is turned off for it before its first prompt, so neither the user's chains nor senpi's shipped ones apply (#12006)", async () => {
    // given
    const engine = processRunner(["retry_fallback_command"])

    // when
    await engine.runner.start(spec("st_p3", { model: "anthropic/claude-opus-5-5" }))

    // then
    const commands = engine.commands()
    expect(commands.map((command) => command.type)).toEqual(["get_protocol_info", "set_retry_fallback", "prompt"])
    expect(commands[1]?.retryFallback).toEqual({ modelFallback: false, fallbackChains: { "anthropic/claude-opus-5-5": [] } })
  })

  // A child whose chain the engine does not hold would run on the engine's own fallback settings (the user's
  // chains, senpi's shipped chains), i.e. on models outside its designated chain. It is never prompted at all:
  // no prompt means no model, the parent's included, receives a request for it (#12006).
  test("#given an older engine without the command #when two children start #then neither is prompted and each start fails naming the missing command", async () => {
    // given
    const engine = processRunner([])

    // when
    const first = engine.runner.start(spec("st_p4", CHAINED))
    await expect(first).rejects.toMatchObject({ failure: { kind: "child-prompt-failed" } })
    const second = engine.runner.start(spec("st_p5", { model: "anthropic/claude-opus-5-5" }))

    // then: each failure names every designated model, in try order
    await expect(second).rejects.toThrow("retry_fallback_command")
    await expect(first).rejects.toThrow("(anthropic/claude-opus-5-5 -> openai/gpt-5.6-sol -> kimi-coding/kimi-k3)")
    await expect(second).rejects.toThrow("(anthropic/claude-opus-5-5)")
    expect(engine.commands().map((command) => command.type)).not.toContain("prompt")
    expect(engine.commands().map((command) => command.type)).not.toContain("set_retry_fallback")
  })

  test("#given an engine whose protocol answer carries no data #when a child starts #then it is read as an engine without the command and the child is never prompted", async () => {
    // given
    const engine = processRunner(["retry_fallback_command"], { protocolInfo: "no-data" })

    // when
    const started = engine.runner.start(spec("st_p10", CHAINED))

    // then
    await expect(started).rejects.toThrow("no retry_fallback_command")
    expect(engine.commands().map((command) => command.type)).toEqual(["get_protocol_info"])
  })

  test("#given an engine that refuses the chain #when a child with fallback models starts #then it is never prompted and the start fails saying the chain was refused", async () => {
    // given
    const engine = processRunner(["retry_fallback_command"], { retryFallback: "refuse" })

    // when
    const started = engine.runner.start(spec("st_p6", CHAINED))

    // then
    await expect(started).rejects.toThrow("refused")
    expect(engine.commands().map((command) => command.type)).toEqual(["get_protocol_info", "set_retry_fallback"])
  })

  test.each([
    { retryFallback: "hang", command: "set_retry_fallback" },
    { protocolInfo: "after-prompt", command: "get_protocol_info" },
  ] as const)("#given an engine that never answers $command #when its deadline expires #then the start fails and no prompt or later chain is sent", async (options) => {
    // given
    const engine = processRunner(["retry_fallback_command"], { ...options, fallbackChainDeadlineMs: 50 })
    const received = engine.waitForCommand(options.command)
    let watchdog: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      watchdog = setTimeout(() => reject(new Error(`fake engine did not receive ${options.command}`)), 5_000)
    })
    const clock = fakeClock()
    try {
      // when: child boot and pipe delivery use real I/O; only the launch deadline is advanced.
      const started = engine.runner.start(spec("st_deadline", CHAINED))
      const rejected = started.then(() => undefined, (error: unknown) => error)
      await Promise.race([received, deadline])
      await clock.advance(50)
      const error = await rejected
      expect(error).toBeInstanceOf(Error)
      if (!(error instanceof Error)) throw new Error("expected the start to fail")
      expect(error.message).toContain("no answer")
      clock.restore()
      await engine.runner.settleTeardowns()

      // then: read the final transcript after the child has stopped.
      expect(engine.commands().map((command) => command.type)).toEqual(
        options.command === "get_protocol_info"
          ? ["get_protocol_info"]
          : ["get_protocol_info", "set_retry_fallback"],
      )
    } finally {
      clock.restore()
      clearTimeout(watchdog)
    }
  })

  test("#given a child that exits while its chain is being sent #when it starts #then the start fails on the dead child and says it exited, not that the chain was refused", async () => {
    // given
    const engine = processRunner(["retry_fallback_command"], { retryFallback: "exit" })

    // when
    const started = engine.runner.start(spec("st_p8", CHAINED))

    // then
    await expect(started).rejects.toMatchObject({ failure: { kind: "child-prompt-failed", rejected_while: "exited" } })
    await expect(started).rejects.toThrow("exited")
    await expect(started).rejects.not.toThrow("refused")
  })
})

const PRIMARY: ResolvedModelRecord = { provider: "openai", model_id: "gpt-5.6-sol", display: "openai/gpt-5.6-sol", source: "category" }
const SAME_PROVIDER: ResolvedModelRecord = { provider: "openai", model_id: "gpt-5.5", display: "openai/gpt-5.5", source: "category" }
const OTHER_PROVIDER: ResolvedModelRecord = { provider: "kimi-coding", model_id: "kimi-k3", display: "kimi-coding/kimi-k3", source: "category" }
// The engine's typed prompt refusals (senpi `ModelNotReadyError` on the RPC wire): a provider with no
// stored key, and a stored login that could not be refreshed.
const MISSING = { error: "No API key found for openai.", errorCode: "provider_credentials_missing", errorData: { provider: "openai" } }
const EXPIRED = { error: "Authentication failed for \"kimi-coding\".", errorCode: "provider_credentials_expired", errorData: { provider: "kimi-coding" } }

const chainPlanner: ChildPlanner = () => ({
  kind: "resolved",
  plan: { model: PRIMARY.display, resolved_model: PRIMARY, category: "unspecified-high", fallback_models: [SAME_PROVIDER, OTHER_PROVIDER] },
})

describe("a process child whose prompt start is refused for missing provider credentials (#10806)", () => {
  test("#given the primary provider has no key and the next provider's login expired #when the task starts #then it skips the same-provider rung, hops to the next provider, and fails typed listing both refusals", async () => {
    // given
    const { runner, launched } = refusingProcessRunner({ [PRIMARY.display]: MISSING, [OTHER_PROVIDER.display]: EXPIRED }, children)
    const { manager, store } = makeManager({ planner: chainPlanner, process: createRpcManagedRunner(runner) })

    // when
    const result = await manager.start({
      prompt: "work", parent_session_id: "parent-1", depth: 1, category: "unspecified-high", execution_mode: "process",
    })
    // A launch slower than start's 250 ms report window (a loaded Windows runner) is reported as still
    // starting; either way the outcome lands on the task record, so the assertions read it from there.
    await launchSettled(manager, result).catch(() => undefined)

    // then
    if (result.kind !== "start_failed" && !(result.kind === "started" && result.starting === true)) {
      throw new Error(`expected start_failed or a still-starting start, got ${JSON.stringify(result)}`)
    }
    const record = store.load(result.task_id)
    expect(launched).toEqual([PRIMARY.display, OTHER_PROVIDER.display])
    expect(record?.failure_kind).toBe("model_chain_exhausted")
    const fallbacks = taskEvents(store.stateDir, result.task_id).filter((event) => event.type === "task_model_fallback")
    expect(fallbacks.map((event) => [event.payload.from_model, event.payload.to_model, event.payload.cause_class, event.payload.cause_code, event.payload.provider])).toEqual([
      [PRIMARY.display, OTHER_PROVIDER.display, "credentials_missing", "provider_credentials_missing", "openai"],
    ])
    expect(record?.error_message).toContain(`${PRIMARY.display}: not signed in`)
    expect(record?.error_message).toContain(`${OTHER_PROVIDER.display}: not signed in`)
    expect(record?.status).toBe("error")
    await runner.settleTeardowns()
  })

  test("#given a credentials refusal whose errorData carries more than the provider #when the start fails #then the typed error keeps only the validated provider", async () => {
    // given: security contract - the refusal's payload never rides on the error a later log could serialize
    const refusal = { ...MISSING, errorData: { provider: "openai", detail: "api_key=sk-live-secret" } }
    const { runner } = refusingProcessRunner({ [PRIMARY.display]: refusal }, children)

    // when
    const started = runner.start(spec("st_c2", { model: PRIMARY.display }))

    // then
    const failure = await started.then(() => undefined, (error: unknown) => error)
    expect(failure).toMatchObject({ failure: { kind: "child-prompt-failed", cause: { name: "RpcCommandError", errorCode: "provider_credentials_missing" } } })
    expect((failure as { failure: { cause: { errorData?: unknown } } }).failure.cause.errorData).toEqual({ provider: "openai" })
    await runner.settleTeardowns()
  })
})
