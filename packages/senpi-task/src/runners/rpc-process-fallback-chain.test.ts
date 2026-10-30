import type { ChildProcess } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { cleanupProjects, launchSettled, makeManager } from "../manager/__fixtures__/manager-fakes"
import { refusingProcessRunner, taskEvents } from "../manager/__fixtures__/refusing-process-runner"
import { createRpcManagedRunner } from "../manager/runner"
import type { ChildPlanner } from "../manager/types"
import type { ResolvedModelRecord } from "../state"
import { spawnFakeChild } from "./rpc/__fixtures__/spawn-fake"
import { terminateRpcChild } from "./rpc/terminate"
import { RpcProcessRunner } from "./rpc-process"
import type { RpcRunnerSpec } from "./types"

const children: ChildProcess[] = []
const tmpDirs: string[] = []

afterEach(async () => {
  for (const child of children.splice(0)) await terminateRpcChild(child, { sigkillDelayMs: 200 })
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
  readonly warnings: string[]
  commands(): Array<{ readonly type: string; readonly retryFallback?: unknown }>
}

function processRunner(
  capabilities: readonly string[],
  options: {
    readonly retryFallback?: "refuse" | "hang" | "exit"
    readonly protocolInfo?: "after-prompt"
    readonly fallbackChainDeadlineMs?: number
  } = {},
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
        ...(options.protocolInfo === undefined ? {} : { FAKE_PROTOCOL_INFO: options.protocolInfo }),
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
    // A cold child can answer the capability probe after the deadline too; either way the chain is never
    // sent once the prompt is out (#9582 flake on windows-latest).
    const types = engine.commands().map((command) => command.type)
    expect(types.slice(0, 1)).toEqual(["get_protocol_info"])
    expect(types.at(-1)).toBe("prompt")
    expect(engine.warnings).toHaveLength(1)
    expect(engine.warnings[0]).toContain("st_p7")
    expect(engine.warnings[0]).toContain("no answer")
  })

  test("#given an engine that answers the capability probe only after the deadline #when a child with fallback models starts #then the chain is never sent after its first prompt", async () => {
    // given
    const engine = processRunner(["retry_fallback_command"], { protocolInfo: "after-prompt", fallbackChainDeadlineMs: 50 })

    // when
    const handle = await engine.runner.start(spec("st_p9", CHAINED))

    // then
    await handle.waitForIdle()
    expect(handle.lastAssistantText()).toBe("hello")
    // A round trip after the turn: the child reads stdin in order, so a chain written late is logged before it.
    await handle.getEntries?.()
    expect(engine.commands().map((command) => command.type)).toEqual(["get_protocol_info", "prompt", "get_entries"])
    expect(engine.warnings).toHaveLength(1)
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

const PRIMARY: ResolvedModelRecord = { provider: "openai", model_id: "gpt-5.6-sol", display: "openai/gpt-5.6-sol", source: "category" }
const SAME_PROVIDER: ResolvedModelRecord = { provider: "openai", model_id: "gpt-5.5", display: "openai/gpt-5.5", source: "category" }
const OTHER_PROVIDER: ResolvedModelRecord = { provider: "kimi-coding", model_id: "kimi-k3", display: "kimi-coding/kimi-k3", source: "category" }
const PARENT = "anthropic/claude-opus-5-5"
// The engine's typed prompt refusals (senpi `ModelNotReadyError` on the RPC wire): a provider with no
// stored key, and a stored login that could not be refreshed.
const MISSING = { error: "No API key found for openai.", errorCode: "provider_credentials_missing", errorData: { provider: "openai" } }
const EXPIRED = { error: "Authentication failed for \"kimi-coding\".", errorCode: "provider_credentials_expired", errorData: { provider: "kimi-coding" } }

const chainPlanner: ChildPlanner = () => ({
  kind: "resolved",
  plan: { model: PRIMARY.display, resolved_model: PRIMARY, category: "unspecified-high", fallback_models: [SAME_PROVIDER, OTHER_PROVIDER] },
})

describe("a process child whose prompt start is refused for missing provider credentials (#10806)", () => {
  test("#given the primary provider has no key and the next provider's login expired #when the task starts #then it skips the same-provider rung, hops to the next provider, then lands on the parent rung", async () => {
    // given
    const { runner, launched } = refusingProcessRunner({ [PRIMARY.display]: MISSING, [OTHER_PROVIDER.display]: EXPIRED }, children)
    const { manager, store } = makeManager({ planner: chainPlanner, process: createRpcManagedRunner(runner) })

    // when
    const result = await manager.start({
      prompt: "work", parent_session_id: "parent-1", depth: 1, category: "unspecified-high", execution_mode: "process", parent_model: PARENT,
    })
    await launchSettled(manager, result)

    // then
    if (result.kind !== "started") throw new Error(`expected started, got ${JSON.stringify(result)}`)
    expect(launched).toEqual([PRIMARY.display, OTHER_PROVIDER.display, PARENT])
    const fallbacks = taskEvents(store.stateDir, result.task_id).filter((event) => event.type === "task_model_fallback")
    expect(fallbacks.map((event) => [event.payload.from_model, event.payload.to_model, event.payload.cause_class, event.payload.cause_code, event.payload.provider])).toEqual([
      [PRIMARY.display, OTHER_PROVIDER.display, "credentials_missing", "provider_credentials_missing", "openai"],
      [OTHER_PROVIDER.display, PARENT, "credentials_missing", "provider_credentials_expired", "kimi-coding"],
    ])
    const record = store.load(result.task_id)
    expect(record?.model).toBe(PARENT)
    expect(record?.fallback_models ?? []).toEqual([])
    expect(record?.parent_model_fallback?.reason).toBe("not_signed_in")
    expect(record?.parent_model_fallback?.from_model).toBe(OTHER_PROVIDER.display)
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
