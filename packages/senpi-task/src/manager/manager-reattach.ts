import { log } from "@oh-my-opencode/utils"

import type { ReattachResult } from "../lifecycle/port"
import type { TaskRecord } from "../state"
import type { TaskRecordStore } from "../store"
import { discardManagedHandle, type ManagedChildHandle } from "./child-handle"
import { isTerminalRecord, nowIso, recordSpawnedRunner } from "./manager-helpers"

/**
 * Bind a freshly respawned handle back onto its record: verify this host still holds the claim,
 * refuse a task that already has a live handle, then either refresh a terminal record's launch
 * facts or open a NEW run epoch for a continuing one. Every failure path tears the handle down, so
 * a rejected reattach never leaves a child nobody owns.
 */
export async function reattachManagedTask(input: {
  readonly record: TaskRecord
  readonly handle: ManagedChildHandle
  readonly store: TaskRecordStore
  readonly hostPid: number
  readonly now: () => number
  readonly isAttached: (taskId: string) => boolean
  readonly attachLive: (record: TaskRecord, handle: ManagedChildHandle) => () => void
  readonly detachLive: (taskId: string, handle: ManagedChildHandle, unsubscribe: () => void) => void
  readonly destroyAttached: (taskId: string) => Promise<void>
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
  let attached = false
  try {
    unsubscribe = input.attachLive(fresh, input.handle)
    attached = true
    if (isTerminalRecord(fresh)) {
      const pid = input.handle.pid
      const sessionId = input.handle.sessionId
      if (pid !== undefined || (sessionId !== undefined && sessionId.length > 0)) {
        input.store.mutate(fresh.task_id, (current) => ({
          ...current,
          ...(pid === undefined ? {} : { pid }),
          ...(sessionId === undefined || sessionId.length === 0 ? {} : { child_session_id: sessionId }),
        }))
      }
      return { ok: true }
    }
    const { error_message: _error, final_response: _final, killed: _killed, ...rest } = fresh
    const epoch = fresh.notification.run_epoch + 1
    const timestamp = nowIso(input.now)
    const sessionId = input.handle.sessionId
    // A revived daemon child is identified by its session, exactly as a fresh spawn stamps it.
    const withRunner = recordSpawnedRunner(rest, input.handle.kind, input.handle.hostSession) ?? rest
    const reattached: TaskRecord = {
      ...withRunner,
      status: "running",
      started_at: fresh.started_at ?? timestamp,
      updated_at: timestamp,
      notification: { ...fresh.notification, run_epoch: epoch },
      ...(input.handle.pid === undefined ? {} : { pid: input.handle.pid }),
      ...(sessionId === undefined || sessionId.length === 0 ? {} : { child_session_id: sessionId }),
    }
    input.store.replace(reattached)
    input.armOutcome(reattached, input.handle, epoch)
    return { ok: true }
  } catch (error) {
    if (attached) await input.destroyAttached(fresh.task_id)
    else await discardManagedHandle(input.handle)
    if (unsubscribe !== undefined) input.detachLive(fresh.task_id, input.handle, unsubscribe)
    log("senpi-task reattach failed", { taskId: fresh.task_id, error: String(error) })
    return { ok: false, kind: "failed", reason: "manager reattach failed" }
  }
}
