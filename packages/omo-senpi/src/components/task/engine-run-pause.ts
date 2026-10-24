import type { TaskManager } from "../../../../senpi-task/src/manager/types"
import type { TaskPauseMethods } from "../../../../senpi-task/src/manager/run-pause"
import type { TaskRecord } from "../../../../senpi-task/src/state"
import type { AdmissionBarrier, ResumeCredential } from "../../../../senpi-task/src/pause/admission-barrier"
import type { EnginePauseState, RunRef, RunPauseOwner } from "../../../../senpi-task/src/pause/ports"
import { PauseRegistry, type PauseParticipant } from "../../../../senpi-task/src/pause/registry"
import { RunPauseController, type RunPauseEffects } from "../../../../senpi-task/src/pause/run-controller"
import { EngineRunPauseBridge } from "./run-pause-bridge"
import { createWorkpoolRunPauseSource } from "./workpool-run-pause-source"

export type RunPauseSource = {
  refs(parentSessionId: string): readonly RunRef[]
  runRefForTask?(taskId: string): RunRef | undefined
  quiesce?(parentSessionId: string, pauseSeq: number): void | Promise<void>
  dispatchGuidance?(parentSessionId: string, pauseSeq: number, resumeId: string): Promise<void>
  install?(parentSessionId: string, pauseSeq: number, credential: ResumeCredential): Promise<void>
  released?(parentSessionId: string): void | Promise<void>
  cancel?(parentSessionId: string, runRef: RunRef): Promise<void>
}

export function createEngineRunPause(ports: {
  readonly stateDir: string
  readonly barrier: AdmissionBarrier
  readonly manager: TaskManager & TaskPauseMethods
  readonly runtime: { getPauseState(): EnginePauseState | undefined; fenceRun(runRef: RunRef): void }
  readonly resumeAdmission?: RunPauseEffects["resume"]
}) {
  const registry = new PauseRegistry(ports.stateDir, ports.barrier)
  const sources = new Set<RunPauseSource>()
  const admission = (record: TaskRecord): PauseParticipant["admission"] => {
    const state = ports.manager.concurrency?.admission(record.task_id, record.notification.run_epoch)
    if (state === undefined) return undefined
    const { model, laneKey, sequence, phase } = state
    return { model, laneKey, sequence, phase }
  }
  if (ports.manager.workpools !== undefined) sources.add(createWorkpoolRunPauseSource({
    stateDir: ports.stateDir, barrier: ports.barrier, workpools: ports.manager.workpools,
    ownedSessions: parent => [parent, ...ownedSubtree(ports.manager.list({ scope: "all" }).map(entry => entry.record), parent)
      .flatMap(record => record.child_session_id === undefined ? [] : [record.child_session_id])],
  }))
  const effects: RunPauseEffects = {
    snapshot(parentSessionId, admissions) {
      const records = ownedSubtree(ports.manager.list({ scope: "all" }).map(entry => entry.record), parentSessionId)
      const participants: PauseParticipant[] = records.filter(record =>
        record.status === "running" || record.status === "pending" || record.status === "paused",
      ).map(record => {
        const sourceRef = [...sources].map(source => source.runRefForTask?.(record.task_id)).find(ref => ref !== undefined)
        const runRef: RunRef = sourceRef ?? (record.owner !== undefined ? { kind: "dag", id: record.owner.runId }
          : record.team_run_id !== undefined ? { kind: "team", id: record.team_run_id } : { kind: "task", id: record.task_id })
        const allocation = admission(record)
        return {
          key: record.task_id, taskId: record.task_id, runRef, runEpoch: record.notification.run_epoch,
          kind: record.status === "pending" ? "held_admission" : runRef.kind === "dag" ? "dag_node"
            : runRef.kind === "workpool" ? "workpool_worker" : runRef.kind === "team" ? "team_member" : "task",
          ...(record.owner === undefined ? {} : { nodeId: record.owner.nodeId }),
          ...(allocation === undefined ? {} : { admission: allocation }),
          state: "pending", at: record.updated_at,
        }
      })
      for (const admission of admissions) {
        if (participants.some(participant => participant.key === admission.key)) continue
        participants.push({ ...admission, kind: "held_admission", state: "pending", at: new Date().toISOString() })
      }
      for (const source of sources) for (const runRef of source.refs(parentSessionId)) {
        const key = `run:${runRef.kind}:${runRef.id}`
        if (!participants.some(participant => participant.key === key)) participants.push({
          key, runRef, kind: "held_admission", state: "pending", at: new Date().toISOString(),
        })
      }
      return participants
    },
    async quiesce(parentSessionId, pauseSeq) {
      ports.manager.withdrawAdmissions?.(Object.values(registry.require(parentSessionId).participants)
        .flatMap(participant => participant.taskId === undefined ? [] : [participant.taskId]))
      await Promise.all([...sources].map(source => source.quiesce?.(parentSessionId, pauseSeq)))
    },
    settleCreations: parentSessionId => ports.barrier.creationsSettled(parentSessionId),
    async addFences(_parentSessionId, _pauseSeq, runs) { for (const run of runs) ports.runtime.fenceRun(run) },
    async pause(participant, owner) {
      const record = participant.taskId === undefined ? undefined : ports.manager.get(participant.taskId)
      if (record === undefined || record.notification.run_epoch !== participant.runEpoch ||
        (record.status !== "running" && record.status !== "paused")) return { kind: "settled" }
      if (ports.barrier.isCreating(owner.parentSessionId, record.task_id)) return { kind: "pending" }
      const ack = await ports.manager.pauseTask(record.task_id, owner)
      // Another parent owns this child's custody: it is not part of this run's pause.
      if ("refused" in ack) return { kind: "settled" }
      const allocation = admission(record)
      if (allocation !== undefined) registry.update(owner.parentSessionId, owner.parentPauseSeq, participant.key, { admission: allocation })
      return { kind: "held", childSeq: ack.childSeq }
    },
    async dispatchGuidance(parentSessionId, pauseSeq, resumeId) {
      for (const source of sources) await source.dispatchGuidance?.(parentSessionId, pauseSeq, resumeId)
    },
    observeHold: async (participant, parentSessionId) =>
      participant.taskId === undefined ? undefined : ports.manager.observeTaskHold(participant.taskId, parentSessionId),
    async resume(participant, request, credential) {
      if (participant.key.startsWith("run:")) return { kind: "resumed" }
      // A queued admission has no engine to hold it: it is always re-admitted, lost or not.
      if (participant.kind === "held_admission") {
        if (credential === undefined) throw new Error("a queued admission resumes only inside a resume transaction")
        if (ports.resumeAdmission !== undefined) return ports.resumeAdmission(participant, request, credential)
        if (participant.runRef.kind === "task" && ports.manager.resumeHeldTask !== undefined) {
          return ports.manager.resumeHeldTask(participant, credential)
        }
        throw new Error("held admission resumption port is not configured")
      }
      if (participant.state === "lost" && participant.taskId !== undefined) {
        const resumed = await ports.manager.resumeLostTask(participant.taskId, {
          ...request, ...(credential === undefined ? {} : { resumeCredential: credential }),
        })
        if ("notHeld" in resumed) return { kind: "settled" }
        if ("otherHoldLive" in resumed) return { kind: "held_by_user", childSeq: resumed.childSeq ?? request.childSeqCutoff ?? 0 }
        return { kind: "resumed", turnId: resumed.turnId }
      }
      if (credential === undefined) throw new Error("a paused child resumes only inside a resume transaction")
      const record = participant.taskId === undefined ? undefined : ports.manager.get(participant.taskId)
      if (record === undefined || record.notification.run_epoch !== participant.runEpoch ||
        (record.status !== "running" && record.status !== "paused")) return { kind: "settled" }
      // Unpausing clears the run owner, so a running child at this epoch was already resumed by a
      // transaction the host died inside; resuming it again would fail and wedge the Resume.
      if (record.status === "running" && record.run_pause === undefined) return { kind: "resumed" }
      if (request.childSeqCutoff === undefined) throw new Error("child resume has no frozen cutoff")
      const resumed = await ports.manager.resumePausedTask(record.task_id, {
        ...request, childSeqCutoff: request.childSeqCutoff, resumeCredential: credential,
        ...(participant.admission === undefined ? {} : { allocation: participant.admission }),
      })
      if ("otherHoldLive" in resumed) {
        const childSeq = resumed.childSeq ?? participant.observedChildSeq
        if (childSeq === undefined) throw new Error("child hold has no sequence")
        return { kind: "held_by_user", childSeq }
      }
      return { kind: "resumed", turnId: resumed.turnId }
    },
    async install(parentSessionId, pauseSeq, credential) {
      for (const source of sources) await source.install?.(parentSessionId, pauseSeq, credential)
    },
    async acknowledgeInstalled(parentSessionId, pauseSeq, resumeId) { registry.markInstalled(parentSessionId, pauseSeq, resumeId) },
    async cancel(participant, parentSessionId) {
      if (participant.taskId !== undefined) {
        const record = ports.manager.get(participant.taskId)
        if (record?.notification.run_epoch === participant.runEpoch) await ports.manager.cancelTask(participant.taskId)
      } else {
        const source = [...sources].find(source => source.refs(parentSessionId).some(ref =>
          ref.kind === participant.runRef.kind && ref.id === participant.runRef.id))
        if (source?.cancel === undefined) throw new Error("held run cancellation port is not configured")
        await source.cancel(parentSessionId, participant.runRef)
      }
    },
  }
  const controller = new RunPauseController(registry, effects)
  return {
    registry, controller, bridge: new EngineRunPauseBridge(controller, ports.runtime, async parent => {
      for (const source of sources) await source.released?.(parent)
    }),
    notePausedChild(record: TaskRecord, owner: RunPauseOwner, childSeq: number): void {
      const prior = registry.require(owner.parentSessionId).participants[record.task_id]
      const allocation = admission(record) ?? prior?.admission
      registry.add(owner.parentSessionId, owner.parentPauseSeq, {
        ...prior, key: record.task_id, taskId: record.task_id, runRef: owner.runRef,
        runEpoch: record.notification.run_epoch,
        kind: owner.runRef.kind === "dag" ? "dag_node" : owner.runRef.kind === "workpool" ? "workpool_worker" : owner.runRef.kind === "team" ? "team_member" : "task",
        state: "held", ackSeq: owner.parentPauseSeq, observedChildSeq: childSeq, at: record.updated_at,
        ...(allocation === undefined ? {} : { admission: allocation }),
      })
    },
    register(source: RunPauseSource): () => void { sources.add(source); return () => { sources.delete(source) } },
    // A cancelled run leaves the pause ledger: its participants are settled and dropped.
    async forgetRun(parentSessionId: string, runRef: RunRef): Promise<void> {
      if (registry.load(parentSessionId) !== undefined) await controller.cancel(parentSessionId, runRef)
    },
  }
}

export function ownedSubtree(records: readonly TaskRecord[], parentSessionId: string): readonly TaskRecord[] {
  const sessions = new Set([parentSessionId])
  let added = true
  while (added) {
    added = false
    for (const record of records) if (sessions.has(record.parent_session_id) && record.child_session_id !== undefined && !sessions.has(record.child_session_id)) {
      sessions.add(record.child_session_id)
      added = true
    }
  }
  return records.filter(record => sessions.has(record.parent_session_id)).sort((a, b) =>
    a.created_at.localeCompare(b.created_at) || a.task_id.localeCompare(b.task_id))
}
