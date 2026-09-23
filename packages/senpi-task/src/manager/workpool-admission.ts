import type { ToolDefinition } from "@code-yeongyu/senpi"
import { acquireSessionAdmissionLease } from "../lifecycle/admission-lease"
import { createTaskId } from "../state/id"
import { messageability, type TaskRecord } from "../state"
import { oneShotPolicyDenial } from "../steering/engine-policy"
import { isColdRevivalCandidate } from "../lifecycle/revive-policy"
import { createWorkpoolStore } from "../workpool/store"
import { acknowledgeWorkerTurn, appendAssignedMessages, beginWorkerTurn, WORKPOOL_TURN_MESSAGE } from "../workpool/worker-turn"
import type { ReviveReservation, SendOutcome } from "../steering/types"
import { WorkpoolError, type WorkpoolAgent, type WorkpoolCaller, type WorkpoolSpec } from "../workpool/types"
import type { WorkpoolAdmission, WorkpoolRequest } from "../workpool/ports"
import { resolveWorkerKernelTools } from "../workpool/worker-kernel-tools"
import type { KernelToolBindingRegistry } from "../kernel-tools/bindings"
import { TaskConcurrency } from "./concurrency"
import { decideDepthPolicy } from "./depth-policy"
import { resolveExecutionMode } from "./execution-mode"
import { prepareWorkpoolLaunch, type WorkpoolLaunch } from "./workpool-start"
import { workpoolProcessLaunch } from "./workpool-process-launch"
import type { TaskManagerOptions } from "./types"

export type PoolManagerPorts = {
  readonly options: TaskManagerOptions
  readonly concurrency: TaskConcurrency
  readonly hostPid: number
  readonly get: WorkpoolAdmission["get"]
  readonly pending: WorkpoolAdmission["pending"]
  readonly cancel: WorkpoolAdmission["cancel"]
  readonly waitFor: WorkpoolAdmission["waitFor"]
  launch(context: WorkpoolLaunch): Promise<{ ok: true } | { ok: false; error: string }>
  revive(record: TaskRecord, message: string, reservation: ReviveReservation): Promise<SendOutcome>
  trackRevive(taskId: string, epoch: number): void
  nextSequence(parentSessionId: string): number
  workerTools(taskId: string): readonly ToolDefinition[]
  // The parent engine's runtime kernel-tool map. Absent = no pool may hold parent tools.
  readonly kernelToolBindings?: KernelToolBindingRegistry
}

export function createWorkpoolAdmission(ports: PoolManagerPorts): WorkpoolAdmission {
  const { options, concurrency } = ports
  const stores = { pools: createWorkpoolStore(options.store.stateDir), tasks: options.store }
  function resolve(caller: WorkpoolCaller, agent: WorkpoolAgent): WorkpoolSpec {
    const start = {
      ...agent, parent_session_id: caller.sessionId, root_session_id: caller.rootSessionId,
      depth: caller.depth + 1, cwd: caller.cwd,
    }
    const result = options.planner(start)
    if (result.kind === "error") throw new WorkpoolError("policy_denied", result.error.message)
    const plan = result.plan
    const decision = decideDepthPolicy({ childDepth: start.depth, maxDepth: plan.maxDepth ?? options.config.max_depth,
      targetAgentType: agent.subagent_type ?? plan.agentType, allowedSubagents: plan.allowedSubagents ?? [] })
    if (!decision.allowed) throw new WorkpoolError("policy_denied", decision.reason)
    // A pool worker follows the same chain as a task child. The `auto` resolution is READ here, not
    // awaited: pool creation is synchronous by contract, so a pool opened before this session ever
    // ensured the daemon gets the conservative in-process default.
    const autoMode = options.executionModeGate?.current()
    const executionMode = resolveExecutionMode({
      agentMode: plan.agentExecutionMode,
      configMode: options.config.default_execution_mode,
      ...(autoMode === undefined ? {} : { autoMode }),
    })
    return { start: { ...start, execution_mode: executionMode }, plan }
  }

  function request(input: WorkpoolRequest): { cancel(): void } {
    const { pool, item, worker } = input
    const taskId = worker?.task_id ?? item.binding?.task_id ?? createTaskId()
    const epoch = worker === undefined ? 0 : worker.run_epoch + 1
    const model = pool.worker_spec.plan.model
    const turn = { pool_id: pool.pool_id, generation: pool.generation, task_id: taskId, run_epoch: epoch }
    let cancelled = false
    let granted = false
    let transferred = false
    const release = (): void => concurrency.releaseLease(taskId, epoch)
    const current = (): boolean => !cancelled && input.current()
    const event = (kind: "granted" | "dispatched"): void => input.event({ kind, pool_id: pool.pool_id, item_id: item.item_id, task_id: taskId, run_epoch: epoch })

    async function launch(): Promise<void> {
      try {
        if (!current()) return
        event("granted")
        input.authorize()
        if (worker !== undefined) {
          const record = ports.get(taskId)
          if (record === undefined || record.parent_session_id !== pool.parent_session_id || record.notification.run_epoch !== worker.run_epoch ||
            (!isColdRevivalCandidate(record) && messageability(record.status, record.residency_state, record.execution_mode, record.killed) !== "revive") ||
            oneShotPolicyDenial(record) !== undefined || (ports.pending(taskId) && (record.pending_steering ?? []).some(entry => entry.workpool?.pool_id !== pool.pool_id))) {
            throw new WorkpoolError("worker_not_continuable", "Worker is no longer eligible for reuse.")
          }
          if (!input.bind(taskId, epoch)) return
          appendAssignedMessages(stores, turn)
          if (beginWorkerTurn(stores, turn) === undefined) return
          const result = await ports.revive(record, WORKPOOL_TURN_MESSAGE, { ok: true, release, commit: () => { transferred = true; ports.trackRevive(taskId, epoch) } })
          if (result.kind !== "revived") {
            if (options.store.load(taskId)?.revive_delivery_uncertain?.run_epoch === epoch) {
              throw new WorkpoolError("delivery_uncertain", "The admitted turn ended before its delivery acknowledgment was persisted.")
            }
            throw refusal(result)
          }
          acknowledgeWorkerTurn(stores, turn)
          transferred = true
        } else {
          const acquired = await acquireSessionAdmissionLease(options.store.stateDir, pool.parent_session_id)
          if (acquired.kind !== "acquired") throw new WorkpoolError("admission_refused", "Residency admission is contended.")
          let context: WorkpoolLaunch
          try {
            if (!current()) return
            const admission = await options.admit?.(pool.parent_session_id)
            if (admission?.kind === "rejected") throw new WorkpoolError("admission_refused", admission.message)
            if (!current()) return
            input.authorize()
            if (!acquired.lease.isOwner()) throw new WorkpoolError("admission_refused", "Residency admission lease was displaced.")
            // Grants are resolved AFRESH for every new worker: an existing worker never rebinds.
            const kernelTools = await resolveWorkerKernelTools(pool, ports.kernelToolBindings, options.resolveChildToolNames?.())
            const processLaunch = pool.worker_spec.start.execution_mode === "process"
              ? await workpoolProcessLaunch(options.store.stateDir, taskId, options.resolveInheritedExtensions)
              : undefined
            if (!input.bind(taskId, epoch)) return
            context = prepareWorkpoolLaunch({ options, workerSpec: pool.worker_spec, taskId, hostPid: ports.hostPid,
              taskSeq: ports.nextSequence(pool.parent_session_id),
              spec: { ...pool.worker_spec.start,
                memberScopedTools: ports.workerTools(taskId),
                ...(kernelTools === undefined ? {} : { kernelTools }),
                ...(processLaunch === undefined ? {} : processLaunch),
              },
            })
          } finally { acquired.lease.release() }
          if (!current()) { await ports.cancel(taskId); return }
          appendAssignedMessages(stores, turn)
          const captured = beginWorkerTurn(stores, turn, context.managedSpec.prompt)
          if (captured === undefined) return
          const result = await ports.launch({ ...context, managedSpec: { ...context.managedSpec, prompt: captured.message } })
          if (!result.ok) throw new WorkpoolError("spawn_failed", result.error)
          transferred = true
          acknowledgeWorkerTurn(stores, turn, captured.entries)
        }
        event("dispatched")
      } catch (error) {
        const failure = error instanceof WorkpoolError ? error : new WorkpoolError(transferred ? "delivery_uncertain" : "spawn_failed", error instanceof Error ? error.message : "Worker admission failed.")
        input.event({ kind: "admission_failed", pool_id: pool.pool_id, item_id: item.item_id, task_id: taskId, run_epoch: epoch,
          error: { code: failure.code, message: failure.message } })
      } finally { if (!transferred) release() }
    }
    concurrency.enqueue(model, taskId, epoch, () => { granted = true; void launch() })
    return { cancel: () => {
      cancelled = true
      concurrency.remove(model, taskId)
      // A grant inside an async residency gate owns its lease until that gate unwinds.
      if (!granted) release()
    } }
  }
  return { tasks: options.store, resolve, request, hasFreeSlot: model => concurrency.hasFreeSlot(model), drain: () => concurrency.drain(),
    get: ports.get, pending: ports.pending, cancel: ports.cancel, waitFor: ports.waitFor }
}

function refusal(outcome: Exclude<SendOutcome, { kind: "revived" }>): WorkpoolError {
  switch (outcome.kind) {
    case "delivery_uncertain": case "admission_refused": case "cwd_unavailable": case "config_generation_mismatch": case "scope_denied":
      return new WorkpoolError(outcome.kind, outcome.reason)
    case "capacity_deferred": return new WorkpoolError("admission_refused", outcome.reason)
    case "one_shot_agent": return new WorkpoolError("worker_not_continuable", outcome.message)
    case "not_continuable": case "not_found": return new WorkpoolError("worker_not_continuable", outcome.reason)
    case "queued": case "steered": return new WorkpoolError("delivery_uncertain", "Worker did not acknowledge the expected admitted epoch.")
    default: return assertNever(outcome)
  }
}
function assertNever(value: never): never { throw new Error(`Unknown send outcome: ${String(value)}`) }
