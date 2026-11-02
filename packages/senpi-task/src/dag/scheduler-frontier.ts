import { dagRunStartedEvent, dagRunFailedEvent, dagRunCompletedEvent, dagWaveStartedEvent, dagWaveCompletedEvent } from "./events"
import { countNodes, nodeError, nodeById, transition, TERMINAL_NODE_STATES, type SchedulerContext } from "./scheduler-context"
import { cancelledSnapshot } from "./scheduler-cancellation"
import { admitFrontier } from "./scheduler-admission"
import { settleOne } from "./scheduler-task-attachment"
import type { DagNode, DagNodeId } from "./types"
import type { DagRunRecordV1 } from "./manager"

export async function runFrontier(context: SchedulerContext): Promise<DagRunRecordV1> {
  if (context.suspended) return context.journal.snapshot()
  if (context.journal.snapshot().status === "pending") {
    context.journal.append(dagRunStartedEvent({ generation: context.journal.snapshot().generation }))
  }

  for (;;) {
    if (context.suspended || context.cancellationStarted) return cancelledSnapshot(context)
    // The skip cascade runs only at frontier quiescence (nothing attached), generalizing the
    // barrier-era rule that dependents were skipped between waves: a failed node stays revivable
    // (send -> revive) while any sibling is still mid-flight, and a revived outcome can complete
    // it, so an eager cascade would strand the dependent as skipped (dag_2d12c2f7 regression).
    if (context.attachedTasks.size === 0) applyDependentSkipCascade(context)
    // Completions are reported before the next admission pass so a finishing wave reads as
    // settled before later-wave nodes it unblocked start interleaving their own events.
    emitCompletedWaves(context)
    if (!await admitFrontier(context) || context.suspended) return cancelledSnapshot(context)
    const current = context.journal.snapshot()
    if (current.nodes.every((node) => TERMINAL_NODE_STATES.has(node.state))) break
    if (context.attachedTasks.size === 0 && !context.infrastructureRetries.pending()) {
      // A retry timer may fire while the admission await yields, after its frontier scan.
      if (context.infrastructureRetries.takeReady()) continue
      // #8396 (second symptom): every admission of this pass failed at start, so nothing is
      // attached while the dependents still sit pending. Their skip cascade runs at the top of the
      // loop; throwing here instead left the run `running` forever (28 leaves failed at admission,
      // 2 aggregators pending, retry refused with run_still_active).
      if (hasCascadableDependent(current)) continue
      throw new Error(`DAG run "${current.runId}" cannot terminalize while nodes are active`)
    }
    if (!await settleOne(context)) return cancelledSnapshot(context)
  }

  const snapshot = context.journal.snapshot()
  const failed = primaryFailure(snapshot)
  if (failed !== undefined) {
    const error = failed.error ?? nodeError(failed.id, "start_failed", "DAG node failed", context.now)
    context.journal.append(dagRunFailedEvent({ error, counts: countNodes(snapshot.nodes) }))
  } else {
    context.journal.append(dagRunCompletedEvent({ counts: countNodes(snapshot.nodes) }))
  }
  return context.journal.snapshot()
}

function applyDependentSkipCascade(context: SchedulerContext): void {
  let changed = true
  while (changed) {
    changed = false
    const snapshot = context.journal.snapshot()
    for (const node of snapshot.nodes) {
      if (!isCascadableDependent(snapshot, node)) continue
      transition(context, node.id, "skipped", { kind: "skipped" })
      changed = true
    }
  }
}

function hasCascadableDependent(record: DagRunRecordV1): boolean {
  return record.nodes.some((node) => isCascadableDependent(record, node))
}

function isCascadableDependent(record: DagRunRecordV1, node: DagNode): boolean {
  if (node.state !== "pending" && node.state !== "blocked") return false
  return node.dependsOn.some((dependencyId) => {
    const dependency = nodeById(record, dependencyId)
    return TERMINAL_NODE_STATES.has(dependency.state) && dependency.state !== "completed"
  })
}

function primaryFailure(record: DagRunRecordV1): DagNode | undefined {
  for (const wave of record.waves) {
    for (const nodeId of wave.nodeIds) {
      const node = nodeById(record, nodeId)
      if (node.state === "failed") return node
    }
  }
  return undefined
}

export function emitWaveAdmissions(context: SchedulerContext, scheduled: readonly DagNodeId[]): void {
  if (scheduled.length === 0) return
  const waveIndexOf = waveIndexByNodeId(context.journal.snapshot())
  const groups = new Map<number, DagNodeId[]>()
  for (const nodeId of scheduled) {
    const waveIndex = waveIndexOf.get(nodeId)
    if (waveIndex === undefined) continue
    const group = groups.get(waveIndex) ?? []
    group.push(nodeId)
    groups.set(waveIndex, group)
  }
  for (const waveIndex of [...groups.keys()].sort((a, b) => a - b)) {
    context.journal.append(dagWaveStartedEvent({ waveIndex, nodeIds: groups.get(waveIndex) ?? [] }))
    context.emittedWaveAdmissions.add(waveIndex)
  }
}

function emitCompletedWaves(context: SchedulerContext): void {
  if (context.emittedWaveAdmissions.size === 0) return
  const snapshot = context.journal.snapshot()
  const states = new Map(snapshot.nodes.map((node) => [node.id, node.state]))
  for (const wave of snapshot.waves) {
    if (!context.emittedWaveAdmissions.has(wave.index) || context.emittedWaveCompletions.has(wave.index)) continue
    const settled = wave.nodeIds.every((nodeId) => {
      const state = states.get(nodeId)
      return state !== undefined && TERMINAL_NODE_STATES.has(state)
    })
    if (!settled) continue
    context.journal.append(dagWaveCompletedEvent({ waveIndex: wave.index, nodeIds: wave.nodeIds }))
    context.emittedWaveCompletions.add(wave.index)
  }
}

function waveIndexByNodeId(record: DagRunRecordV1): ReadonlyMap<DagNodeId, number> {
  const indexes = new Map<DagNodeId, number>()
  for (const wave of record.waves) {
    for (const nodeId of wave.nodeIds) indexes.set(nodeId, wave.index)
  }
  return indexes
}
