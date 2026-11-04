import type { TaskManager } from "../../../../senpi-task/src/manager/types"
import type { TaskPauseMethods } from "../../../../senpi-task/src/manager/run-pause"
import type { ControlAck } from "../../../../senpi-task/src/control/control-schema"
import type { DesiredState, RequesterChannel } from "../../../../senpi-task/src/control/requester-channel"
import type { ResumeCredential } from "../../../../senpi-task/src/pause/admission-barrier"
import type { RunPauseOwner } from "../../../../senpi-task/src/pause/ports"
import type { PauseParticipant, PauseRegistry } from "../../../../senpi-task/src/pause/registry"
import { inRemoteClass, type RemoteResult } from "../../../../senpi-task/src/pause/remote-participants"
import type { ResumeParticipantRequest } from "../../../../senpi-task/src/pause/run-controller"
import type { TaskRecord } from "../../../../senpi-task/src/state"
import { createOwnerHandoff } from "./engine-run-pause-handoff"

const ACK_POLL_MS = 100
const TERMINAL_REFUSALS = new Set(["not_in_ancestry", "epoch_moved", "settled"])

export type RemoteRunPausePorts = {
  readonly channel: RequesterChannel
  readonly manager: TaskManager & TaskPauseMethods
  readonly registry: PauseRegistry
  readonly wait?: (ms: number) => Promise<void>
  readonly now?: () => number
  // A flagged record whose owner left it: the per-record cancel watcher finishes it (design 3.7).
  readonly armCancelWatcher?: (taskId: string) => void
  readonly store?: import("../../../../senpi-task/src/store").TaskRecordStore
  readonly isProcessAlive?: (pid: number) => boolean
}

type Exchange = { readonly ack?: ControlAck; readonly reason?: RemoteResult["reason"] }
type ResumeAnswer = { readonly kind: "resumed"; readonly turnId?: string } | { readonly kind: "held_by_user"; readonly childSeq: number } | { readonly kind: "settled" } | RemoteResult

// The requester's effects for a child another live process owns (design 3.2): the run reaches it by
// writing the desired state and reading the owner's ack; a formerly remote child whose owner died is
// handed to the local path.
export function createRemoteRunPause(ports: RemoteRunPausePorts) {
  const now = ports.now ?? Date.now
  const wait = ports.wait ?? ((ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms).unref?.() }))
  const handoff = createOwnerHandoff(ports)

  const fresh = (participant: PauseParticipant): TaskRecord | undefined =>
    participant.taskId === undefined ? undefined : ports.manager.get(participant.taskId)

  function isRemote(participant: PauseParticipant): boolean {
    const record = fresh(participant)
    return record !== undefined && record.notification.run_epoch === participant.runEpoch && ports.channel.ownedElsewhere(record)
  }

  function desired(participant: PauseParticipant, record: TaskRecord, owner: RunPauseOwner): DesiredState {
    const ledger = ports.registry.load(owner.parentSessionId)
    const base = { taskId: record.task_id, runEpoch: record.notification.run_epoch, parentSessionId: owner.parentSessionId,
      pauseSeq: owner.parentPauseSeq, runRef: owner.runRef, ...(participant.guidance === undefined ? {} : { guidance: participant.guidance }) }
    if (record.cancel_requested !== undefined) return { ...base, phase: "cancelled",
      cancel: { requestedAt: record.cancel_requested.requested_at, ...(record.cancel_requested.reason === undefined ? {} : { reason: record.cancel_requested.reason }) } }
    if (ledger?.phase === "resuming" || ledger?.phase === "resumed") {
      return { ...base, phase: "resumed", resumeId: ledger.resume?.resumeId ?? `parent-resume:${owner.parentPauseSeq}` }
    }
    return { ...base, phase: "paused" }
  }

  async function exchange(record: TaskRecord, state: DesiredState, deadlineAt: number): Promise<Exchange> {
    const reason = ports.channel.cannotApply(record)
    if (reason !== undefined) return { reason }
    // Guidance that does not fit is not truncated (design 3.1): the register is written without it and the
    // ledger keeps it, so the Stop or Resume itself still reaches the owner instead of waiting on it.
    const write = ports.channel.assertDesired(state)
    if (write.kind === "refused" && write.reason === "guidance_too_large") ports.channel.assertDesired({ ...state, guidance: [] })
    for (;;) {
      const ack = ports.channel.acceptedAck(state, record.cancel_requested !== undefined)
      if (ack !== undefined) return { ack }
      if (now() >= deadlineAt) return {}
      await wait(ACK_POLL_MS)
    }
  }

  function settleGuidance(participant: PauseParticipant, owner: RunPauseOwner, ack: ControlAck | undefined): void {
    const reported = new Set((ack?.guidance ?? []).map(entry => entry.inputId))
    if (reported.size === 0 || participant.guidance === undefined) return
    ports.registry.update(owner.parentSessionId, owner.parentPauseSeq, participant.key,
      { guidance: participant.guidance.filter(entry => !reported.has(entry.inputId)) })
  }

  function remote(participant: PauseParticipant, record: TaskRecord, exchanged: Exchange, held: boolean): RemoteResult {
    const handleGone = exchanged.ack?.state === "refused" && exchanged.ack.reason === "handle_gone"
    const reason = exchanged.reason ?? (handleGone ? "handle_gone" : undefined)
    return { kind: "remote", state: held ? "held_remote" : participant.state === "held_remote" ? "held_remote" : "owned_elsewhere",
      ownerPid: record.host_pid ?? 0, ...(reason === undefined ? {} : { reason }),
      ...(held && exchanged.ack !== undefined ? { ackSeq: exchanged.ack.pauseSeq, ...(exchanged.ack.childSeq === undefined ? {} : { childSeq: exchanged.ack.childSeq }) } : {}) }
  }

  // Stop mapping (design 3.2): held -> held_remote; settled/cancelled and terminal refusals -> settled;
  // anything else, or no ack inside the deadline, keeps the participant remote.
  async function pause(participant: PauseParticipant, owner: RunPauseOwner, deadlineAt: number): Promise<RemoteResult | { readonly kind: "settled" } | { readonly kind: "held"; readonly childSeq: number } | undefined> {
    const record = fresh(participant)
    if (record === undefined || participant.kind === "held_admission") return undefined
    if (!isRemote(participant)) return inRemoteClass(participant) ? handoff.hold(participant, record, owner) : undefined
    const exchanged = await exchange(record, desired(participant, record, owner), deadlineAt)
    settleGuidance(participant, owner, exchanged.ack)
    const ack = exchanged.ack
    if (ack?.state === "settled" || ack?.state === "cancelled" || (ack?.state === "refused" && TERMINAL_REFUSALS.has(ack.reason ?? ""))) return { kind: "settled" }
    return remote(participant, record, exchanged, ack?.state === "held")
  }

  async function resume(participant: PauseParticipant, request: ResumeParticipantRequest, credential: ResumeCredential | undefined,
    deadlineAt: number): Promise<ResumeAnswer | undefined> {
    const record = fresh(participant)
    if (record === undefined || participant.kind === "held_admission") return undefined
    if (!isRemote(participant)) return inRemoteClass(participant) ? handoff.resume(participant, record, request, credential) : undefined
    const exchanged = await exchange(record, desired(participant, record, request), deadlineAt)
    settleGuidance(participant, request, exchanged.ack)
    const ack = exchanged.ack
    if (ack === undefined) return remote(participant, record, exchanged, false)
    if (ack.state === "resumed") return { kind: "resumed", ...(ack.turnId === undefined ? {} : { turnId: ack.turnId }) }
    if (ack.state === "held_by_user") return ack.reason === "owner_held" ? remote(participant, record, exchanged, true) : { kind: "held_by_user", childSeq: ack.childSeq ?? 0 }
    if (ack.state === "settled" || ack.state === "cancelled" || (ack.state === "refused" && TERMINAL_REFUSALS.has(ack.reason ?? ""))) return { kind: "settled" }
    return remote(participant, record, exchanged, ack.state === "held")
  }

  return { isRemote, pause, resume, desired, now }
}
