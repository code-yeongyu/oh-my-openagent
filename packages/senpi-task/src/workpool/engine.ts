import { randomBytes } from "node:crypto"
import { EMPTY_SKILL_INVOCATIONS, evaluateInvocationGuard } from "../agents/invocation-guard"
import { createWorkpoolDispatcher } from "./dispatcher"
import type { WorkpoolAdmission } from "./ports"
import { canonicalJson, parseInput, WorkpoolCreateSchema, WorkpoolItemsSchema } from "./schema"
import type { KernelToolBindingRegistry } from "../kernel-tools/bindings"
import type { KernelToolGrant } from "../kernel-tools/resolve"
import { normalizeKernelToolName } from "../kernel-tools/names"
import { resolvePoolKernelTools } from "./worker-kernel-tools"
import { createWorkpoolYieldCapability } from "./worker-capability"
import { createWorkpoolStore } from "./store"
import { deliverAggregate, poolWorkIsFinished, type WorkpoolAggregatePort } from "./aggregate"
import { WORKPOOL_DEFAULT_MODE } from "./default-mode"
import { WorkpoolError, type WorkpoolAgent, type WorkpoolCaller, type WorkpoolCreate, type WorkpoolEvent, type WorkpoolInput, type WorkpoolItem, type PoolId, type ItemId } from "./types"

export function createWorkpoolEngine(stateDir: string, admission: WorkpoolAdmission, kernelToolBindings?: KernelToolBindingRegistry) {
  const store = createWorkpoolStore(stateDir)
  // The pool ids THIS engine bound, so disposal releases its own bindings without touching the
  // child-task entries that share the map.
  const boundPools = new Set<PoolId>()
  const releaseKernelTools = (poolId: PoolId): void => {
    if (!boundPools.delete(poolId)) return
    kernelToolBindings?.release(poolId)
  }
  const listeners = new Set<(event: WorkpoolEvent) => void>()
  let aggregatePort: WorkpoolAggregatePort | undefined
  const awaitingAck = new Set<string>()
  const emit = (event: WorkpoolEvent): void => {
    for (const listener of listeners) listener(event)
    if (event.kind === "item_result" || event.kind === "worker_idle" || event.kind === "cancelled") flushAggregate(event.pool_id)
  }
  function persistAggregate(poolId: PoolId, generation: number, state: { readonly delivered: boolean; readonly accepted: boolean }): void {
    store.mutate(poolId, pool => pool.generation !== generation ? pool : {
      ...pool,
      aggregate: state.delivered ? { generation, delivered: true }
        : { generation, delivered: false, ...(state.accepted ? { accepted: true } : {}) },
    })
  }
  function flushAggregate(poolId: PoolId): void {
    const pool = store.load(poolId)
    // Close-completion: the last worker of a closed pool is gone and no item is outstanding.
    if (poolWorkIsFinished(pool)) releaseKernelTools(pool.pool_id)
    const key = `${pool.pool_id}:${pool.generation}`
    if (pool.aggregate?.delivered === true && pool.aggregate.generation === pool.generation) return
    if (awaitingAck.has(key) || pool.aggregate?.accepted === true && pool.aggregate.generation === pool.generation) return
    awaitingAck.add(key)
    const started = deliverAggregate(pool, aggregatePort, state => {
      persistAggregate(pool.pool_id, pool.generation, state)
      if (state.delivered || !state.accepted) awaitingAck.delete(key)
    }, error => emit({ kind: "aggregate_failed", pool_id: pool.pool_id, error: { code: "delivery_uncertain", message: error instanceof Error ? error.message : String(error) } }))
    if (!started) awaitingAck.delete(key)
  }
  let checkPolicy = (agent: WorkpoolAgent, _parent: string): void => {
    if (agent.subagent_type === undefined) return
    const verdict = evaluateInvocationGuard(agent.subagent_type, EMPTY_SKILL_INVOCATIONS)
    if (verdict.kind === "deny") throw new WorkpoolError("policy_denied", verdict.message)
  }
  const dispatcher = createWorkpoolDispatcher({ store, admission, emit, authorize: pool => checkPolicy(pool.agent, pool.parent_session_id) })
  function assertParent(caller: WorkpoolCaller): void {
    if (caller.sessionId.trim().length === 0) throw new WorkpoolError("scope_denied", "A host session identity is required.")
    for (const pool of store.list()) {
      const bindings = [...pool.workers, ...pool.items.flatMap(item => item.binding === undefined ? [] : [item.binding])]
      if (bindings.some(worker => admission.get(worker.task_id)?.child_session_id === caller.sessionId)) {
        throw new WorkpoolError("scope_denied", "Assigned workers may only yield their current assignment.")
      }
    }
  }
  /**
   * Resolve requested worker-tool names against the caller's LIVE capability before a pool exists.
   * The caller (the workpool tool) awaits this and hands the grant to `create`, which stays
   * synchronous for every existing caller.
   */
  async function resolveKernelTools(
    caller: WorkpoolCaller,
    value: WorkpoolCreate,
    capability: unknown,
    existingToolNames?: readonly string[],
  ) {
    const names = (value.tools ?? []).map(normalizeKernelToolName)
    if (names.length === 0) return undefined
    assertParent(caller)
    return await resolvePoolKernelTools({
      names,
      capability,
      spec: admission.resolve(caller, value.agent),
      ...(existingToolNames === undefined ? {} : { existingToolNames }),
    })
  }

  // Only the normalized NAMES are persisted; the live capability stays in the runtime binding map
  // and every later worker spawn re-resolves against it.
  function create(caller: WorkpoolCaller, value: WorkpoolCreate, grant?: KernelToolGrant) {
    assertParent(caller)
    const input = parseInput(WorkpoolCreateSchema, value)
    const names = (input.tools ?? []).map(normalizeKernelToolName)
    if (names.length > 0 && grant === undefined) {
      throw new WorkpoolError("tools_unavailable", "Parent-defined worker tools need a live JavaScript kernel capability.")
    }
    checkPolicy(input.agent, caller.sessionId)
    const pool = store.create(caller, { ...input, mode: input.mode ?? WORKPOOL_DEFAULT_MODE, tools: names }, admission.resolve(caller, input.agent))
    if (grant !== undefined) {
      kernelToolBindings?.bind(pool.pool_id, grant)
      boundPools.add(pool.pool_id)
    }
    dispatcher.schedule(pool.pool_id)
    return pool
  }
  function inspect(caller: WorkpoolCaller, poolId: string) { assertParent(caller); return store.owned(caller, poolId) }
  function push(caller: WorkpoolCaller, poolId: string, values: readonly WorkpoolInput[]) {
    const owned = inspect(caller, poolId)
    const inputs = parseInput(WorkpoolItemsSchema, values)
    const receipts: { key: string; item_id: ItemId }[] = []
    store.mutate(owned.pool_id, pool => {
      if (pool.status !== "open") throw new WorkpoolError("pool_closed", "This pool no longer accepts items.")
      const items: WorkpoolItem[] = [...pool.items]
      for (const input of inputs) {
        const prior = items.find(item => item.key === input.key)
        if (prior !== undefined && canonicalJson(prior.input) !== canonicalJson(input.input)) {
          throw new WorkpoolError("duplicate_key_conflict", "The key already identifies different input.")
        }
        const item: WorkpoolItem = prior ?? { ...input, item_id: `wi_${randomBytes(16).toString("hex")}`, status: "queued" }
        if (prior === undefined) items.push(item)
        receipts.push({ key: item.key, item_id: item.item_id })
      }
      return items.length === pool.items.length ? pool : { ...pool, items }
    })
    dispatcher.schedule(owned.pool_id)
    emit({ kind: "queued", pool_id: owned.pool_id })
    return { pool_id: owned.pool_id, item_ids: receipts }
  }
  function close(caller: WorkpoolCaller, poolId: string) {
    const owned = inspect(caller, poolId)
    const closed = store.mutate(owned.pool_id, pool => pool.status === "open" ? { ...pool, status: "closing" } : pool)
    flushAggregate(owned.pool_id)
    return closed
  }
  function cancel(caller: WorkpoolCaller, poolId: string) {
    const owned = inspect(caller, poolId)
    const cancelled = store.mutate(owned.pool_id, pool => pool.status === "cancelled" ? pool : {
      ...pool, status: "cancelled", generation: pool.generation + 1,
      items: pool.items.map(item => item.status === "queued" || item.status === "assigned" ? {
        ...item, status: "cancelled", error: { code: "cancelled", message: "Pool cancelled." },
      } : item),
    })
    dispatcher.cancel(owned.pool_id)
    // A cancelled pool never spawns another worker, so its binding goes now - the workers still
    // tearing down keep their own per-child bindings until destruction releases them.
    releaseKernelTools(owned.pool_id)
    for (const worker of cancelled.workers) void admission.cancel(worker.task_id)
    emit({ kind: "cancelled", pool_id: owned.pool_id })
    return cancelled
  }
  const yieldResults = createWorkpoolYieldCapability(store, admission.tasks, emit)
  function waitForEvent(poolId: PoolId, kind: WorkpoolEvent["kind"], signal: AbortSignal): Promise<WorkpoolEvent> {
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
      const cleanup = (): void => { listeners.delete(listener); signal.removeEventListener("abort", abort) }
      const listener = (event: WorkpoolEvent): void => { if (event.pool_id === poolId && event.kind === kind) { cleanup(); resolve(event) } }
      const abort = (): void => { cleanup(); reject(signal.reason) }
      listeners.add(listener)
      signal.addEventListener("abort", abort, { once: true })
    })
  }
  return { create, resolveKernelTools, inspect, push, close, cancel, yieldResults, waitForEvent,
    setSpawnPolicy: (policy: (agent: WorkpoolAgent, parent: string) => void) => { checkPolicy = policy },
    ownsTask: (taskId: string) => store.list().some(pool => pool.workers.some(worker => worker.task_id === taskId) || pool.items.some(item => item.binding?.task_id === taskId)),
    subscribe: (listener: (event: WorkpoolEvent) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    attach: (caller: WorkpoolCaller) => {
      assertParent(caller)
      for (const pool of store.list()) if (pool.parent_session_id === caller.sessionId) {
        dispatcher.attach(pool.pool_id)
        const key = `${pool.pool_id}:${pool.generation}`
        if (pool.aggregate?.accepted === true && pool.aggregate.delivered !== true && pool.aggregate.generation === pool.generation && !awaitingAck.has(key)) {
          persistAggregate(pool.pool_id, pool.generation, { delivered: false, accepted: false })
        }
        flushAggregate(pool.pool_id)
      }
    },
    bindAggregate: (port: WorkpoolAggregatePort) => { aggregatePort = port; for (const pool of store.list()) flushAggregate(pool.pool_id) },
    noteAggregateFailure: (poolId: PoolId, generation: number) => {
      awaitingAck.delete(`${poolId}:${generation}`)
      persistAggregate(poolId, generation, { delivered: false, accepted: false })
    },
    dispose: () => {
      dispatcher.stopScheduling(); listeners.clear(); awaitingAck.clear()
      for (const poolId of [...boundPools]) releaseKernelTools(poolId)
    },
  }
}
export type WorkpoolEngine = ReturnType<typeof createWorkpoolEngine>
