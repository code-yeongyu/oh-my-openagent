import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createContext, Script } from "node:vm"
import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import { IdleInjectionCoordinator } from "../../packages/omo-senpi/src/extension/idle-injection-coordinator.ts"
import { FakeExtensionAPI } from "../../packages/omo-senpi/test-support/fake-extension-api.ts"
import { createTaskLifecycle } from "../../packages/senpi-task/src/lifecycle"
import type { ResidencyRegistry } from "../../packages/senpi-task/src/lifecycle/port"
import { createTaskManager } from "../../packages/senpi-task/src/manager/manager"
import { TaskConcurrency } from "../../packages/senpi-task/src/manager/concurrency"
import { createTaskRecordStore } from "../../packages/senpi-task/src/store"
import { buildWorkpoolExecute, createWorkpoolTool } from "../../packages/senpi-task/src/tools/workpool"
import type { WorkpoolAggregateMessage } from "../../packages/senpi-task/src/workpool/aggregate.ts"

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error("uninitialized") }
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
function bounded<T>(promise: Promise<T>): Promise<T> {
  const signal = AbortSignal.timeout(5000)
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
}

function openEnv(lanes = 1) {
  const root = mkdtempSync(join(tmpdir(), "omp-item2-eval-"))
  const store = createTaskRecordStore({ project_dir: root })
  const config = OmoTaskSettingsSchema.parse({ default_concurrency: lanes, global_concurrency: lanes, residency_max_children: 4 })
  const concurrency = new TaskConcurrency(config)
  const starts: unknown[] = []
  const runner = { start: async (spec: { taskId: string }) => {
    starts.push(spec)
    return { task_id: spec.taskId, sessionId: `worker-${spec.taskId}`, pid: undefined, waitForOutcome: () => new Promise<never>(() => {}), followUp: async () => undefined, steer: async () => undefined, abort: async () => undefined, dispose: async () => undefined, subscribe: () => () => undefined, lastAssistantText: () => undefined }
  } }
  const registry: ResidencyRegistry = { get: () => undefined, entries: () => [], forget: () => undefined, hasPendingSends: () => false, tryClaimEviction: () => false, releaseEviction: () => undefined }
  const lifecycle = createTaskLifecycle({ store, registry, config })
  const manager = createTaskManager({ store, concurrency, runners: { "in-process": runner, process: runner }, config, cwd: root,
    planner: spec => ({ kind: "resolved", plan: { model: spec.model ?? "test/model" } }), destruction: lifecycle, admit: async () => ({ kind: "admitted" }) })
  const caller = { sessionId: "parent", rootSessionId: "root", depth: 0, cwd: root }
  const ctx = { cwd: root, sessionManager: { getSessionId: () => caller.sessionId } }
  const execute = buildWorkpoolExecute({ manager, workpools: manager.workpools, omoConfig: {}, agents: {} })
  return { root, store, manager, lifecycle, concurrency, starts, caller, ctx, execute }
}

type EvalContext = { cwd: string; sessionManager: { getSessionId: () => string } }
type WorkpoolToolExecute = (
  id: string,
  params: Record<string, unknown>,
  signal: AbortSignal,
  update: () => void,
  context: EvalContext,
) => unknown
function isWorkpoolToolExecute(value: unknown): value is WorkpoolToolExecute {
  return typeof value === "function"
}
function isWorkpoolAggregateMessage(value: unknown): value is WorkpoolAggregateMessage {
  if (typeof value !== "object" || value === null) return false
  if (!("pool_id" in value) || !("generation" in value) || !("results" in value)) return false
  return typeof value.pool_id === "string" && typeof value.generation === "number" && Array.isArray(value.results)
}

function evalCell(host: { execute: unknown }, ctx: EvalContext, code: string) {
  if (!isWorkpoolToolExecute(host.execute)) throw new Error("workpool execute is not a function")
  const execute = host.execute
  const sandbox = {
    tool: {
      workpool: (args: Record<string, unknown>) => execute("eval", args, AbortSignal.timeout(5000), () => undefined, ctx),
    },
  }
  createContext(sandbox)
  return new Script(`(async () => { ${code} })()`).runInContext(sandbox) as Promise<unknown>
}

export async function runEvalAggregate(out: string) {
  const env = openEnv(2)
  const pi = new FakeExtensionAPI()
  pi.cwd = env.root
  const delivered = deferred<WorkpoolAggregateMessage>()
  const coordinator = new IdleInjectionCoordinator((message, options) => {
    pi.sendMessage(message, { triggerTurn: true, deliverAs: options.deliverAs })
    for (const entry of Array.isArray(message.details) ? message.details : []) {
      if (entry.customType === "senpi-task.workpool-aggregate" && isWorkpoolAggregateMessage(entry.details)) delivered.resolve(entry.details)
    }
  })
  const tool = createWorkpoolTool({ manager: env.manager, workpools: env.manager.workpools, omoConfig: {}, agents: {} })
  pi.registerTool({ ...tool })
  env.manager.workpools.bindAggregate({
    enqueue: (message, receipts) => {
      const accepted = coordinator.enqueue({
        key: `workpool:${message.pool_id}:${message.generation}`, source: "workpool-aggregate",
        customType: "senpi-task.workpool-aggregate", content: JSON.stringify(message.results), display: false, details: message,
        onFlushed: () => receipts.ack(), onDeliveryFailed: error => receipts.fail(error),
      })
      if (accepted === false) throw new Error("idle-injection coordinator retired on session shutdown; injection not delivered")
      coordinator.flushSoon()
    },
  })
  try {
    assert.equal(tool.name, "workpool")
    const created = await evalCell(tool, env.ctx, `return await tool.workpool({ op: "create", name: "eval-batch", agent: { category: "quick", prompt: "Process input" } })`) as { details: { pool_id: `wp_${string}`; mode: string } }
    assert.equal(created.details.mode, "keep_alive")
    const poolId = created.details.pool_id
    const dispatched: { task_id?: string; run_epoch?: number }[] = []
    const gotTwo = deferred<void>()
    const stop = env.manager.workpools.subscribe(event => {
      if (event.pool_id === poolId && event.kind === "dispatched") {
        dispatched.push(event)
        if (dispatched.length === 2) gotTwo.resolve()
      }
    })
    await evalCell(tool, env.ctx, `return await tool.workpool(${JSON.stringify({ op: "push", pool_id: poolId, items: [{ key: "a", input: 1 }, { key: "b", input: 2 }] })})`)
    await bounded(gotTwo.promise)
    stop()
    const snapshot = env.manager.workpools.inspect(env.caller, poolId)
    for (const item of snapshot.items) {
      assert.ok(item.binding)
      assert.equal(env.manager.workpools.yieldResults(item.binding.task_id, item.binding.run_epoch, { op: "yield", results: [{ key: item.key, data: item.input }] }).results[0]?.status, "accepted")
    }
    const closed = await evalCell(tool, env.ctx, `return await tool.workpool(${JSON.stringify({ op: "close", pool_id: poolId })})`) as { details: { status: string } }
    assert.equal(closed.details.status, "closing")
    const aggregate = await bounded(delivered.promise)
    assert.equal(pi.messages.length, 1)
    assert.deepEqual(aggregate.results, [{ key: "a", data: 1 }, { key: "b", data: 2 }])
    env.manager.workpools.dispose()
    const reset = openReset(env.root)
    try {
      const resetTool = createWorkpoolTool({ manager: reset.manager, workpools: reset.manager.workpools, omoConfig: {}, agents: {} })
      const resetPi = new FakeExtensionAPI()
      resetPi.registerTool({ ...resetTool })
      const inspected = await evalCell(resetTool, env.ctx, `return await tool.workpool(${JSON.stringify({ op: "inspect", pool_id: poolId })})`) as { details: { pool_id: string } }
      assert.equal(inspected.details.pool_id, poolId)
      assert.equal(resetPi.tools[0]?.name, "workpool")
      return { passed: true, out, pool_id: poolId, mode: created.details.mode, aggregate, inspected: inspected.details, hostTool: "workpool", parentMessages: pi.messages.length }
    } finally { reset.manager.workpools.dispose(); reset.lifecycle.dispose?.() }
  } finally { env.manager.workpools.dispose(); env.lifecycle.dispose?.(); coordinator.retire(); rmSync(env.root, { recursive: true, force: true }) }
}

export async function runCancelUncertainNotify(out: string) {
  const env = openEnv()
  try {
    env.concurrency.tryAcquire("test/model", "st_00000001", 0)
    env.manager.workpools.bindAggregate({ enqueue: () => { throw new Error("notifier down") } })
    const created = await env.execute({ op: "create", name: "fail-batch", agent: { category: "quick", prompt: "Process input" }, mode: "fresh" }, env.ctx)
    const poolId = (created.details as { pool_id: `wp_${string}` }).pool_id
    const waiting = env.manager.workpools.waitForEvent(poolId, "waiting", AbortSignal.timeout(5000))
    await env.execute({ op: "push", pool_id: poolId, items: [{ key: "late", input: 1 }] }, env.ctx)
    await waiting
    assert.equal(env.starts.length, 0)
    await env.execute({ op: "cancel", pool_id: poolId }, env.ctx)
    assert.equal(env.starts.length, 0)
    const inspected = await env.execute({ op: "inspect", pool_id: poolId }, env.ctx)
    assert.equal((inspected.details as { items: { status: string }[] }).items[0]?.status, "cancelled")
    assert.notEqual((inspected.details as { aggregate?: { delivered: boolean } }).aggregate?.delivered, true)
    const denied = await env.execute({ op: "inspect", pool_id: poolId }, { ...env.ctx, sessionManager: { getSessionId: () => "foreign" } })
    assert.equal((denied.details as { error: { code: string } }).error.code, "scope_denied")
    return { passed: true, out, zeroCapacityPush: { starts: env.starts.length }, cancelled: true, notifierPending: true, crossSession: "scope_denied" }
  } finally { env.manager.workpools.dispose(); env.lifecycle.dispose?.(); rmSync(env.root, { recursive: true, force: true }) }
}

function openReset(root: string) {
  const store = createTaskRecordStore({ project_dir: root })
  const config = OmoTaskSettingsSchema.parse({ default_concurrency: 1, global_concurrency: 1, residency_max_children: 4 })
  const concurrency = new TaskConcurrency(config)
  const runner = { start: async (spec: { taskId: string }) => ({ task_id: spec.taskId, sessionId: `worker-${spec.taskId}`, pid: undefined, waitForOutcome: () => new Promise<never>(() => {}), followUp: async () => undefined, steer: async () => undefined, abort: async () => undefined, dispose: async () => undefined, subscribe: () => () => undefined, lastAssistantText: () => undefined }) }
  const registry: ResidencyRegistry = { get: () => undefined, entries: () => [], forget: () => undefined, hasPendingSends: () => false, tryClaimEviction: () => false, releaseEviction: () => undefined }
  const lifecycle = createTaskLifecycle({ store, registry, config })
  const manager = createTaskManager({ store, concurrency, runners: { "in-process": runner, process: runner }, config, cwd: root,
    planner: spec => ({ kind: "resolved", plan: { model: spec.model ?? "test/model" } }), destruction: lifecycle, admit: async () => ({ kind: "admitted" }) })
  return { manager, lifecycle }
}
