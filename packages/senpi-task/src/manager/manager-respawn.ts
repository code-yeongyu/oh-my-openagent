import { existsSync } from "node:fs"
import { dirname, join } from "node:path"

import { log } from "@oh-my-opencode/utils"

import { hostSessionResumePath, readHostDrainingHold } from "../lifecycle/host-session"
import type { RespawnFailureCode, RespawnResult } from "../lifecycle/port"
import { RunnerError } from "../runners/in-process/runner-error"
import type { RpcChildHandle, RpcRunnerSpec } from "../runners/types"
import type { TaskRecord } from "../state"
import { adaptRpcHandle, discardManagedHandle, discardRpcHandle, type ManagedChildHandle } from "./child-handle"
import { sessionTailFinishedText, sessionTailNeedsContinuation } from "./interrupted-turn"
import { buildRespawnManagedSpec, isTerminalRecord } from "./manager-helpers"
import type { ManagedRunner, TrustedRespawnLaunchResolver } from "./types"

const CONTINUATION_MESSAGE =
  "Your previous turn was interrupted by a host process restart. Resume your task from its current state and finish it - do not restart from scratch, and do not repeat work already recorded in this session."
const RESPAWN_CLEANUP_FAILURE_REASON = "rpc respawn cleanup failed"

type RpcRespawnRunner = { start(spec: RpcRunnerSpec): Promise<RpcChildHandle> }

export async function respawnManagedTask(input: {
  readonly beforeLaunch: () => void
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
  readonly beforeLaunch: () => void
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
      input.beforeLaunch()
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
    input.beforeLaunch()
    handle = await input.rpcRunner.start({
      task_id: input.record.task_id,
      cwd: rebuilt.spec.cwd,
      state_dir: rebuilt.spec.stateDir,
      prompt: rebuilt.spec.prompt,
      model: input.record.model,
      ...(input.record.resolved_model?.variant === undefined ? {} : { variant: input.record.resolved_model.variant }),
      ...(trusted?.extensions === undefined ? {} : { extensions: trusted.extensions }),
      ...(trusted?.memberEnv === undefined ? {} : { memberEnv: trusted.memberEnv }),
      depth: input.record.depth,
      root_session_id: input.record.root_session_id,
    })
    return { ok: true, handle: adaptRpcHandle(handle) }
  } catch (error) {
    if (handle !== undefined) await disposeRpc(handle)
    if (isTeamRuntimeUnavailable(error)) {
      return failure("retryable", "team_inactive", "team runtime is not active")
    }
    const refused = hostRefusal(error)
    if (refused !== undefined) return refused
    log("senpi-task fresh rpc respawn failed", { taskId: input.record.task_id, error: String(error) })
    return failure("retryable", "respawn_failed", "rpc respawn failed")
  }
}

async function respawnInProcess(input: {
  readonly beforeLaunch: () => void
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
    input.beforeLaunch()
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
  readonly beforeLaunch: () => void
  readonly record: TaskRecord
  readonly sessionPath: string
  readonly stateDir: string
  readonly rpcRunner: RpcRespawnRunner
  readonly trustedLaunch?: TrustedRespawnLaunchResolver
}): Promise<RespawnResult> {
  const spawnSpec = input.record.spawn_spec
  if (spawnSpec === undefined) return failure("unrecoverable", "spawn_spec_unavailable", "persisted spawn spec unavailable")
  // A daemon-hosted child resumes the session path its RECORD carries: the daemon owns that
  // transcript, so the newest file in the child's session dir can be the wrong one (or missing).
  const sessionPath = hostSessionResumePath(input.record) ?? input.sessionPath
  // The client owns the session directory (a session whose first reply never landed has one but no
  // JSONL yet). Read it BEFORE the open: a reopening host recreates it for its holder record and
  // starts a fresh, empty session there, which a continuation would then "finish".
  const sessionDirPresent = existsSync(dirname(sessionPath))
  let handle: RpcChildHandle | undefined
  try {
    const trusted = input.trustedLaunch === undefined ? undefined : await input.trustedLaunch(input.record)
    input.beforeLaunch()
    handle = await input.rpcRunner.start({
      task_id: input.record.task_id,
      cwd: spawnSpec.cwd,
      state_dir: join(input.stateDir, "children", input.record.task_id),
      prompt: "",
      resumeSessionPath: sessionPath,
      // The recorded endpoint, never a re-derived one: a pre-migration child keeps living where it was.
      ...(input.record.host_session === undefined ? {} : { hostSocket: input.record.host_session.socket }),
      model: input.record.model,
      ...(input.record.resolved_model?.variant === undefined ? {} : { variant: input.record.resolved_model.variant }),
      ...(trusted?.extensions === undefined ? {} : { extensions: trusted.extensions }),
      ...(trusted?.memberEnv === undefined ? {} : { memberEnv: trusted.memberEnv }),
      depth: input.record.depth,
      root_session_id: input.record.root_session_id,
    })
    // An ATTACHED daemon session is the same live session, mid-turn and all: switching it would
    // reopen what is already open, and a continuation nudge would inject a second prompt into a
    // turn that never stopped. A session the host reopened from its JSONL still gets both.
    if (joinedLiveHostSession(handle)) return { ok: true, handle: adaptRpcHandle(handle) }
    // A host session with nothing live to re-join and its session directory gone lost its work:
    // report that child by itself instead of resuming an empty session under its task id.
    if (isHostSessionHandle(handle) && !sessionDirPresent) {
      const reason = `recorded session transcript is missing: ${dirname(sessionPath)} no longer exists`
      return failure("unrecoverable", "session_unavailable", await disposeRpc(handle) ? reason : RESPAWN_CLEANUP_FAILURE_REASON)
    }
    if (handle.switchSession === undefined) return cleanupFailure(handle, "respawned RPC handle cannot switch sessions")
    const switched = await handle.switchSession(sessionPath)
    if (switched.cancelled) return cleanupFailure(handle, "switch_session was cancelled")
    await continueInterruptedTurn(input.record, sessionPath, adaptRpcHandle(handle))
    await adoptFinishedTurn(input.record, sessionPath, handle)
    return { ok: true, handle: adaptRpcHandle(handle) }
  } catch (error) {
    const cleaned = handle === undefined || await disposeRpc(handle)
    if (isTeamRuntimeUnavailable(error)) {
      return failure("retryable", "team_inactive", "team runtime is not active")
    }
    // The old generation still holds this session path while it drains. That is a wait the
    // lifecycle retries, never a lost child.
    const hold = readHostDrainingHold(error)
    if (hold !== undefined) {
      return {
        ok: false,
        disposition: "retryable",
        code: "host_draining",
        reason: error instanceof Error ? error.message : String(error),
        ...(hold.retryAfterMs === undefined ? {} : { retryAfterMs: hold.retryAfterMs }),
      }
    }
    const refused = hostRefusal(error)
    if (refused !== undefined) return refused
    log("senpi-task rpc respawn failed", { taskId: input.record.task_id, error: String(error) })
    return failure("retryable", "respawn_failed", cleaned ? "rpc respawn failed" : RESPAWN_CLEANUP_FAILURE_REASON)
  }
}

function isHostSessionHandle(handle: RpcChildHandle): boolean {
  return "kind" in handle && handle.kind === "host-session"
}

/**
 * A session the daemon still held when this child re-opened it: re-joined, not restarted. Decided by
 * the host's answer to the open (`openDisposition`), never by the handle's connection liveness
 * (`attached`), which is true after ANY successful open.
 */
function joinedLiveHostSession(handle: RpcChildHandle): boolean {
  return (
    "kind" in handle &&
    handle.kind === "host-session" &&
    (handle as { openDisposition?: unknown }).openDisposition === "attached"
  )
}

async function continueInterruptedTurn(record: TaskRecord, sessionPath: string, handle: ManagedChildHandle): Promise<void> {
  if (!isTerminalRecord(record) && await sessionTailNeedsContinuation(sessionPath, CONTINUATION_MESSAGE)) {
    await handle.followUp(CONTINUATION_MESSAGE)
  }
}

// The child finished its turn while no parent was attached (a handoff, a reload, a stalled host), so
// no agent_end will ever arrive for it: settle the reopened handle with the transcript's final answer
// and let the ordinary outcome tracking complete the record (omo#9069).
async function adoptFinishedTurn(record: TaskRecord, sessionPath: string, handle: RpcChildHandle): Promise<void> {
  if (isTerminalRecord(record) || handle.adoptFinishedTurn === undefined) return
  const finished = await sessionTailFinishedText(sessionPath)
  if (finished !== undefined) await handle.adoptFinishedTurn(finished)
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

// Both are waits the next reconcile retries: the store index could not be written (nothing was
// opened), or the recorded endpoint answers incompatibly (the session is never opened elsewhere).
function hostRefusal(error: unknown): RespawnResult | undefined {
  if (!RunnerError.is(error) || error.failure.kind !== "host_unavailable") return undefined
  const { reason, message } = error.failure
  if (reason !== "store_index_unavailable" && reason !== "host_incompatible") return undefined
  return failure("retryable", reason, message)
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
