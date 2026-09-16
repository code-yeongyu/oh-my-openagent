import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import { loadSenpiBarrel } from "../../packages/senpi-task/src/lazy/senpi-barrel"
import { createKernelToolBindings } from "../../packages/senpi-task/src/kernel-tools/bindings"
import type { KernelToolsCapability } from "../../packages/senpi-task/src/kernel-tools/contract"
import { createTaskManager } from "../../packages/senpi-task/src/manager/manager"
import { createInProcessManagedRunner } from "../../packages/senpi-task/src/manager/runner"
import { InProcessRunner } from "../../packages/senpi-task/src/runners/in-process"
import { createTaskLifecycle } from "../../packages/senpi-task/src/lifecycle"
import { createManagerResidencyRegistry } from "../../packages/omo-senpi/src/components/task/residency-registry"
import { createTaskRecordStore } from "../../packages/senpi-task/src/store"
import { createTaskTool } from "../../packages/senpi-task/src/tools/task"
import { createWorkpoolTool } from "../../packages/senpi-task/src/tools/workpool"

export const FENCE_MS = 30_000

export function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  const signal = AbortSignal.timeout(FENCE_MS)
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(new Error(`${label} did not settle within ${FENCE_MS}ms`))
    signal.addEventListener("abort", abort, { once: true })
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
}

/** The MERGED local S6 producer checkout, injected by path and pinned by SHA. */
export function producerCheckout(): { readonly dir: string; readonly sha: string; readonly verified_by: string } {
  const dir = process.env["OMP_SENPI_PRODUCER"]
  assert.ok(dir !== undefined && existsSync(dir), "OMP_SENPI_PRODUCER must point at the merged senpi S6 checkout")
  assert.ok(
    existsSync(join(dir, "packages/senpi-codemode/src/kernels/js/kernel-tools-registry.js")),
    "the injected checkout does not contain the S6 kernel-tool producer",
  )
  const required = process.env["OMP_SENPI_PRODUCER_SHA"]
  let head: string | undefined
  try {
    head = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
  } catch {
    head = undefined
  }
  if (required !== undefined && head !== undefined) {
    assert.equal(head, required, "producer checkout is not at the required merged SHA")
  }
  const sha = head ?? required
  assert.ok(sha !== undefined, "set OMP_SENPI_PRODUCER_SHA when the injected checkout carries no git metadata")
  return { dir, sha, verified_by: head === undefined ? "declared" : "git" }
}

type ToolCallMessage = { readonly callId: string; readonly toolName: string; readonly args: unknown }
export type KernelInvocationCounts = { readonly attempted: number; readonly succeeded: number }
export type ProducerKernel = {
  readonly capability: KernelToolsCapability
  readonly sha: string
  readonly verified_by: string
  // REAL counts taken at the capability boundary omo owns: how many invocations were attempted and
  // how many actually returned a closure value. `since()` snapshots, so a case can count what
  // happened after a reset without subtracting by hand.
  invocations(): KernelInvocationCounts
  invocationsSince(mark: KernelInvocationCounts): KernelInvocationCounts
  run(input: { cellId: string; code: string; timeoutMs?: number }): Promise<{ ok: boolean; valueRepr?: string }>
  nextToolCall(): Promise<ToolCallMessage>
  reply(callId: string, value: unknown): void
  reset(): Promise<void>
  close(): Promise<void>
  runEvalAgent(args: unknown, options: Record<string, unknown>): Promise<{ text: string }>
}

/** A REAL producer JS worker kernel plus the exported structural capability omo consumes. */
export async function openProducerKernel(sessionId: string): Promise<ProducerKernel> {
  const { dir, sha, verified_by } = producerCheckout()
  const { JavaScriptKernel } = (await import(
    join(dir, "packages/senpi-codemode/src/kernels/js/context-manager.ts")
  )) as { JavaScriptKernel: new (options: Record<string, unknown>) => Record<string, never> }
  const { runEvalAgent } = (await import(join(dir, "packages/senpi-codemode/src/bridges/agent-bridge.ts"))) as {
    runEvalAgent: (args: unknown, options: Record<string, unknown>) => Promise<{ text: string }>
  }
  const kernel = new JavaScriptKernel({ sessionId, cwd: process.cwd(), parallelPoolWidth: 2 }) as unknown as {
    run(input: { cellId: string; code: string; timeoutMs?: number }): Promise<{ ok: boolean; valueRepr?: string }>
    nextToolCall(): Promise<ToolCallMessage>
    deliverToolReply(message: { type: "tool-reply"; callId: string; ok: boolean; value: unknown }): void
    describeKernelTools(names: readonly string[]): Promise<unknown>
    invokeKernelTool(request: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
    reset(): Promise<void>
    close(): Promise<void>
  }
  const counts = { attempted: 0, succeeded: 0 }
  return {
    sha,
    verified_by,
    invocations: () => ({ ...counts }),
    invocationsSince: (mark) => ({ attempted: counts.attempted - mark.attempted, succeeded: counts.succeeded - mark.succeeded }),
    capability: {
      describe: (names) => kernel.describeKernelTools(names),
      invoke: async (request, signal) => {
        counts.attempted += 1
        const value = await kernel.invokeKernelTool({ ...request }, signal)
        counts.succeeded += 1
        return value
      },
    },
    run: (input) => kernel.run({ timeoutMs: FENCE_MS, ...input }),
    nextToolCall: () => kernel.nextToolCall(),
    reply: (callId, value) => kernel.deliverToolReply({ type: "tool-reply", callId, ok: true, value }),
    reset: () => kernel.reset(),
    close: () => kernel.close(),
    runEvalAgent,
  }
}

type ProviderTurn = { readonly toolName?: string; readonly args?: Record<string, unknown>; readonly text?: string }
export type ProviderTurnDecider = (body: string) => ProviderTurn | Promise<ProviderTurn>

/**
 * Deterministic loopback provider: each turn is decided by inspecting the real request body, so the
 * child's tool call and its final answer are produced by the actual agent loop, never injected.
 * The decider may be async, which is how a case sequences a kernel reset exactly between "the
 * worker exists" and "the worker calls its parent tool" without sleeping or polling.
 */
function providerServer(turn: ProviderTurnDecider) {
  let callSeq = 0
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const body = await request.text()
      const next = await turn(body)
      const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      const delta = next.toolName === undefined
        ? { content: next.text ?? "DONE" }
        : {
            tool_calls: [
              {
                index: 0,
                id: `call_${(callSeq += 1).toString().padStart(4, "0")}`,
                type: "function",
                function: { name: next.toolName, arguments: JSON.stringify(next.args ?? {}) },
              },
            ],
          }
      const chunk = {
        id: "fixture",
        object: "chat.completion.chunk",
        created: 1,
        model: "fixture",
        choices: [{ index: 0, delta, finish_reason: next.toolName === undefined ? "stop" : "tool_calls" }],
        usage,
      }
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
        headers: { "content-type": "text/event-stream" },
      })
    },
  })
}

export type ChildEnv = Awaited<ReturnType<typeof openChildEnv>>

// The agent definitions the denial cases exercise, in the same shape omo resolves from omo.json.
export const QA_AGENTS = {
  "rpc-worker": { name: "rpc-worker", executionMode: "process" },
  "restricted-writer": { name: "restricted-writer", disallowedTools: ["write"] },
  "probe-no-write": { name: "probe-no-write", tools: [{ pattern: "write", allow: false }] },
} as const

// The names a child of this parent already carries; session builtins are unioned by the grant rule.
const CHILD_TOOL_NAMES = ["read", "grep", "x_search"]

/** Real omo engine: real store, manager, in-process runner, task and workpool tool definitions. */
export async function openChildEnv(turn: ProviderTurnDecider, options: { readonly idleTimeoutMs?: number } = {}) {
  const { ModelRegistry, ModelRuntime } = await loadSenpiBarrel()
  const root = mkdtempSync(join(tmpdir(), "omp-item6-"))
  const agentDir = join(root, "agent")
  mkdirSync(agentDir)
  const server = providerServer(turn)
  const runtime = ModelRuntime.createSync({ agentDir, allowModelNetwork: false, refreshOnCreate: false })
  const registry = new ModelRegistry(runtime)
  registry.registerProvider("omp-fixture", {
    api: "openai-completions",
    apiKey: "fixture-key",
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    models: [{
      id: "fixture", name: "fixture", reasoning: false, input: ["text" as const],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100_000, maxTokens: 1000,
    }],
  })
  const model = registry.find("omp-fixture", "fixture")
  assert.ok(model)
  const store = createTaskRecordStore({ project_dir: root })
  const kernelToolBindings = createKernelToolBindings()
  const sessions: string[][] = []
  const inProcess = new InProcessRunner({
    kernelToolBindings,
    createSession: async (options) => {
      const { session } = await (await loadSenpiBarrel()).createAgentSession(options)
      sessions.push(session.getActiveToolNames())
      return session
    },
  })
  const runner = createInProcessManagedRunner(inProcess, () => ({
    agentDir, modelRuntime: runtime, modelRegistry: registry, model,
  }))
  const config = OmoTaskSettingsSchema.parse({
    default_concurrency: 2, global_concurrency: 2, residency_max_children: 4,
    ...(options.idleTimeoutMs === undefined ? {} : { resident_idle_timeout_ms: options.idleTimeoutMs }),
  })
  let now = 1000
  let tick: () => void = () => assert.fail("idle reclaimer was never scheduled")
  const manager = createTaskManager({
    store, config, cwd: root, kernelToolBindings, now: () => now,
    destruction: { destroyResidentTask: (taskId, cause) => lifecycle.destroyResidentTask(taskId, cause) },
    runners: { "in-process": runner, process: runner },
    resolveChildToolNames: () => CHILD_TOOL_NAMES,
    planner: () => ({ kind: "resolved", plan: { model: "omp-fixture/fixture" } }),
  })
  const lifecycle = createTaskLifecycle({
    store, config, kernelToolBindings, now: () => now,
    registry: createManagerResidencyRegistry(() => manager),
    idleReclaimerScheduler: { setInterval: (callback) => { tick = callback; return { unref: () => undefined } }, clearInterval: () => undefined },
  })
  const deps = {
    manager,
    omoConfig: { categories: {}, agents: {} },
    agents: QA_AGENTS,
    resolveChildToolNames: () => CHILD_TOOL_NAMES,
    loadSkills: () => ({ prepend: "", resolved: [], missing: [] }),
  }
  const taskTool = createTaskTool(deps)
  const workpoolTool = createWorkpoolTool({ ...deps, workpools: manager.workpools })
  return {
    root, store, manager, taskTool, workpoolTool, kernelToolBindings, inProcess, sessions, lifecycle,
    // TTL park is the ONE clock-driven path: time itself is the behaviour, so the clock is injected
    // and advanced explicitly instead of slept on.
    park: async (taskId: string) => {
      now += config.resident_idle_timeout_ms + 1
      // One sweep, driven directly: the scheduler seam is registered but never fired here, so the
      // TTL expunge pass cannot race this park.
      void tick
      const reclaimed = await lifecycle.reclaimIdleResidents?.()
      return { state: store.load(taskId)?.residency_state, reclaimed }
    },
    context: (capability: KernelToolsCapability | undefined, sessionId = "omp-item6-parent") => ({
      cwd: root,
      sessionManager: { getSessionId: () => sessionId },
      ...(capability === undefined ? {} : { kernelTools: capability }),
    }),
    dispose: () => {
      manager.workpools.dispose()
      lifecycle.dispose?.()
      server.stop(true)
      rmSync(root, { recursive: true, force: true })
    },
  }
}
