import { join } from "node:path"

import { log } from "@oh-my-opencode/utils"

import type { ReattachResult, RespawnFailureCode, RespawnResult } from "../lifecycle/port"
import { RunnerError } from "../runners/in-process/runner-error"
import type { RpcChildHandle, RpcRunnerSpec } from "../runners/types"
import type { TaskRecord } from "../state"
import type { TaskRecordStore } from "../store"
import { adaptRpcHandle, discardManagedHandle, discardRpcHandle, type ManagedChildHandle } from "./child-handle"
import { sessionTailNeedsContinuation } from "./interrupted-turn"
import { buildRespawnManagedSpec, isTerminalRecord, nowIso } from "./manager-helpers"
import type { ManagedRunner, TrustedRespawnLaunchResolver } from "./types"

const CONTINUATION_MESSAGE =
  "Your previous turn was interrupted by a host process restart. Resume your task from its current state and finish it - do not restart from scratch, and do not repeat work already recorded in this session."
const RESPAWN_CLEANUP_FAILURE_REASON = "rpc respawn cleanup failed"

type RpcRespawnRunner = { start(spec: RpcRunnerSpec): RpcChildHandle }

export async function respawnManagedTask(input: {
  readonly record: TaskRecord
  readonly sessionPath: string | undefined
  readonly stateDir: string
  readonly runners: Readonly<Record<"in-process" | "process", ManagedRunner>>
  readonly rpcRunner: RpcRespawnRunner
  readonly trustedLaunch?: TrustedRespawnLaunchResolver
}): Promise<RespawnResult> {
  if (input.sessionPath === undefined) return respawnFresh(input)
  if (input.record.execution_mode === "in-process") return respawnInProcess({ ...input, sessionPath: input.sessionPath })
  return respawnProcess({ ...input, sessionPath: input.sessionPath })
}

async function respawnFresh(input: {
  readonly record: TaskRecord
  readonly stateDir: string
  readonly runners: Readonly<Record<"in-process" | "process", ManagedRunner>>
  readonly rpcRunner: RpcRespawnRunner
  readonly trustedLaunch?: TrustedRespawnLaunchResolver
}): Promise<RespawnResult> {
  const rebuilt = buildRespawnManagedSpec(input.record, input.stateDir)
  if (!rebuilt.ok) return failure("unrecoverable", rebuilt.code, rebuilt.reason)
  if (input.record.execution_mode === "in-process") {
    let handle: ManagedChildHandle | undefined
    try {
      handle = await input.runners["in-process"].start(rebuilt.spec)
      return { ok: true, handle }
    } catch (error) {
      if (handle !== undefined) await discardManagedHandleBestEffort(handle)
      return classifyResumeFailure(error)
    }
  }

  let handle: RpcChildHandle | undefined
  try {
    const trusted = input.trustedLaunch === undefined ? undefined : await input.trustedLaunch(input.record)
    handle = input.rpcRunner.start({
      task_id: input.record.task_id,
      cwd: rebuilt.spec.cwd,
      state_dir: rebuilt.spec.stateDir,
      prompt: rebuilt.spec.prompt,
      model: input.record.model,
      ...(input.record.resolved_model?.variant === undefined ? {} : { variant: input.record.resolved_model.variant }),
      ...(trusted?.extensions === undefined ? {} : { extensions: trusted.extensions }),
      ...(trusted?.memberEnv === undefined ? {} : { memberEnv: trusted.memberEnv }),
    })
    return { ok: true, handle: adaptRpcHandle(handle) }
  } catch (error) {
    if (handle !== undefined) await disposeRpc(handle)
    if (isTeamRuntimeUnavailable(error)) {
      return failure("retryable", "team_inactive", "team runtime is not active")
    }
    log("senpi-task fresh rpc respawn failed", { taskId: input.record.task_id, error: String(error) })
    return failure("retryable", "respawn_failed", "rpc respawn failed")
  }
}

async function respawnInProcess(input: {
  readonly record: TaskRecord
  readonly sessionPath: string
  readonly stateDir: string
  readonly runners: Readonly<Record<"in-process" | "process", ManagedRunner>>
}): Promise<RespawnResult> {
  const rebuilt = buildRespawnManagedSpec(input.record, input.stateDir)
  if (!rebuilt.ok) return failure("unrecoverable", rebuilt.code, rebuilt.reason)
  const resume = input.runners["in-process"].resume
  if (resume === undefined) return failure("unrecoverable", "respawn_failed", "in-process runner cannot resume sessions")
  let handle: ManagedChildHandle | undefined
  try {
    handle = await resume(rebuilt.spec, input.sessionPath)
    await continueInterruptedTurn(input.record, input.sessionPath, handle)
    return { ok: true, handle }
  } catch (error) {
    if (handle !== undefined) {
      try {
        await discardManagedHandle(handle)
      } catch (cleanupError) {
        log("senpi-task in-process respawn cleanup failed", {
          taskId: input.record.task_id,
          error: String(cleanupError),
        })
      }
    }
    return classifyResumeFailure(error)
  }
}

async function respawnProcess(input: {
  readonly record: TaskRecord
  readonly sessionPath: string
  readonly stateDir: string
  readonly rpcRunner: RpcRespawnRunner
  readonly trustedLaunch?: TrustedRespawnLaunchResolver
}): Promise<RespawnResult> {
  const spawnSpec = input.record.spawn_spec
  if (spawnSpec === undefined) return failure("unrecoverable", "spawn_spec_unavailable", "persisted spawn spec unavailable")
  let handle: RpcChildHandle | undefined
  try {
    const trusted = input.trustedLaunch === undefined ? undefined : await input.trustedLaunch(input.record)
    handle = input.rpcRunner.start({
      task_id: input.record.task_id,
      cwd: spawnSpec.cwd,
      state_dir: join(input.stateDir, "children", input.record.task_id),
      prompt: "",
      resumeSessionPath: input.sessionPath,
      model: input.record.model,
      ...(input.record.resolved_model?.variant === undefined ? {} : { variant: input.record.resolved_model.variant }),
      ...(trusted?.extensions === undefined ? {} : { extensions: trusted.extensions }),
      ...(trusted?.memberEnv === undefined ? {} : { memberEnv: trusted.memberEnv }),
    })
    if (handle.switchSession === undefined) return cleanupFailure(handle, "respawned RPC handle cannot switch sessions")
    const switched = await handle.switchSession(input.sessionPath)
    if (switched.cancelled) return cleanupFailure(handle, "switch_session was cancelled")
    await continueInterruptedTurn(input.record, input.sessionPath, adaptRpcHandle(handle))
    return { ok: true, handle: adaptRpcHandle(handle) }
  } catch (error) {
    const cleaned = handle === undefined || await disposeRpc(handle)
    if (isTeamRuntimeUnavailable(error)) {
      return failure("retryable", "team_inactive", "team runtime is not active")
    }
    log("senpi-task rpc respawn failed", { taskId: input.record.task_id, error: String(error) })
    return failure("retryable", "respawn_failed", cleaned ? "rpc respawn failed" : RESPAWN_CLEANUP_FAILURE_REASON)
  }
}

async function continueInterruptedTurn(record: TaskRecord, sessionPath: string, handle: ManagedChildHandle): Promise<void> {
  if (!isTerminalRecord(record) && await sessionTailNeedsContinuation(sessionPath)) {
    await handle.followUp(CONTINUATION_MESSAGE)
  }
}

async function cleanupFailure(handle: RpcChildHandle, reason: string): Promise<RespawnResult> {
  return failure("retryable", "respawn_failed", await disposeRpc(handle) ? reason : RESPAWN_CLEANUP_FAILURE_REASON)
}

async function discardManagedHandleBestEffort(handle: ManagedChildHandle): Promise<void> {
  try {
    await discardManagedHandle(handle)
  } catch (error) {
    log("senpi-task fresh in-process respawn cleanup failed", { taskId: handle.task_id, error: String(error) })
  }
}

async function disposeRpc(handle: RpcChildHandle): Promise<boolean> {
  try {
    await discardRpcHandle(handle)
    return true
  } catch (error) {
    log("senpi-task failed respawn cleanup rejected", { taskId: handle.task_id, error: String(error) })
    return false
  }
}

function classifyResumeFailure(error: unknown): RespawnResult {
  if (RunnerError.is(error)) {
    const { kind, message } = error.failure
    if (kind === "model_unavailable" || kind === "tools_unavailable" || kind === "session_unavailable") {
      return failure("retryable", kind, message)
    }
  }
  return failure("retryable", "respawn_failed", "in-process respawn failed")
}

function isTeamRuntimeUnavailable(error: unknown): boolean {
  if (!(error instanceof Error) || error.name !== "TeamMemberRespawnLaunchError" || !("code" in error)) return false
  return error.code === "runtime_unavailable" || error.code === "runtime_inactive" ||
    error.code === "member_missing" || error.code === "task_mapping_mismatch"
}

function failure(
  disposition: "retryable" | "unrecoverable",
  code: RespawnFailureCode,
  reason: string,
): RespawnResult {
  return { ok: false, disposition, code, reason }
}

export async function reattachManagedTask(input: {
  readonly record: TaskRecord
  readonly handle: ManagedChildHandle
  readonly store: TaskRecordStore
  readonly hostPid: number
  readonly now: () => number
  readonly isAttached: (taskId: string) => boolean
  readonly attachLive: (record: TaskRecord, handle: ManagedChildHandle) => () => void
  readonly detachLive: (taskId: string, handle: ManagedChildHandle, unsubscribe: () => void) => void
  readonly armOutcome: (record: TaskRecord, handle: ManagedChildHandle, epoch: number) => void
}): Promise<ReattachResult> {
  const fresh = input.store.load(input.record.task_id)
  if (fresh?.host_pid !== input.hostPid || fresh.residency_state !== "resident") {
    await discardManagedHandle(input.handle)
    return { ok: false, kind: "failed", reason: "task ownership claim is not held by this host" }
  }
  if (input.isAttached(fresh.task_id)) {
    await discardManagedHandle(input.handle)
    return { ok: false, kind: "already_attached", reason: "task already has a live handle" }
  }
  let unsubscribe: (() => void) | undefined
  try {
    unsubscribe = input.attachLive(fresh, input.handle)
    if (isTerminalRecord(fresh)) {
      input.store.replace({
        ...fresh,
        updated_at: nowIso(input.now),
        ...(input.handle.pid === undefined ? {} : { pid: input.handle.pid }),
      })
      return { ok: true }
    }
    const { error_message: _error, final_response: _final, killed: _killed, ...rest } = fresh
    const epoch = fresh.notification.run_epoch + 1
    const reattached: TaskRecord = {
      ...rest,
      status: "running",
      updated_at: nowIso(input.now),
      notification: { ...fresh.notification, run_epoch: epoch },
      ...(input.handle.pid === undefined ? {} : { pid: input.handle.pid }),
    }
    input.store.replace(reattached)
    input.armOutcome(reattached, input.handle, epoch)
    return { ok: true }
  } catch (error) {
    if (unsubscribe !== undefined) input.detachLive(fresh.task_id, input.handle, unsubscribe)
    await discardManagedHandle(input.handle)
    log("senpi-task reattach failed", { taskId: fresh.task_id, error: String(error) })
    return { ok: false, kind: "failed", reason: "manager reattach failed" }
  }
}
