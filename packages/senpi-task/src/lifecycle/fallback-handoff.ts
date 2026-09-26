import type { ResolvedModelRecord, TaskRecord } from "../state"
import { isHostSessionRecord } from "./host-session"

/**
 * Runtime fallback's handoff between two rungs. The failed rung's child is closed and the next rung
 * has not been spawned yet, so for that span the task has no child of its own: no pid, no daemon
 * session. The record says so explicitly (`fallback_handoff_epoch` equal to its run_epoch), because
 * a pid-less process record is otherwise indistinguishable from a queued or workpool child.
 *
 * Two readers depend on it. Reconciliation keeps a live owner's handoff behind the pid fence and
 * revives a dead owner's handoff instead of losing it, and revival launches the SELECTED next model
 * fresh from the persisted spawn spec: the failed rung's transcript ends in its error, so reopening
 * it would report the task resumed while no turn runs.
 */
export function isFallbackHandoff(record: TaskRecord | null | undefined): record is TaskRecord {
  return record != null
    && record.fallback_handoff_epoch !== undefined
    && record.fallback_handoff_epoch === record.notification.run_epoch
    && record.pid === undefined
    && !isHostSessionRecord(record)
}

export type FallbackRung = {
  readonly model: ResolvedModelRecord
  readonly remaining: readonly ResolvedModelRecord[]
  readonly timestamp: string
}

/**
 * The record of a task handed to its next rung: the next model selected, the epoch advanced past the
 * failed rung's outcome, and every identity of the closed child (pid, daemon session) dropped so no
 * reconciler can mistake the closed child for this task's live one.
 */
export function handOffToNextRung(record: TaskRecord, rung: FallbackRung): TaskRecord {
  const { pid: _closedPid, runner_kind: _closedRunner, host_session: _closedSession, ...rest } = record
  const runEpoch = record.notification.run_epoch + 1
  return {
    ...rest,
    model: rung.model.display,
    resolved_model: rung.model,
    fallback_models: rung.remaining,
    fallback_attempts: [
      ...(record.fallback_attempts ?? (record.resolved_model === undefined ? [] : [record.resolved_model])),
      rung.model,
    ],
    updated_at: rung.timestamp,
    notification: { ...record.notification, run_epoch: runEpoch },
    fallback_handoff_epoch: runEpoch,
  }
}

export function endFallbackHandoff(record: TaskRecord): TaskRecord {
  if (record.fallback_handoff_epoch === undefined) return record
  const { fallback_handoff_epoch: _ended, ...rest } = record
  return rest
}
