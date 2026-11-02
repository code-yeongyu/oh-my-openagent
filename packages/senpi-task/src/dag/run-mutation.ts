import { applyRunPause } from "./run-pause"
import { applyPausedDagEvent, isPausedDagEvent } from "./paused-events"
import { liveLeaseHolder, pausedAmendmentUnsafe } from "./amend-safety"
import type { DagRunRecordV1 } from "./manager"
import type { DagBottleneck, DagDiagnostic, DagEdge, DagNode, DagNodeId, DagRunEvent, DagWave } from "./types"
type DagPersistedDefinition = DagRunRecordV1["definition"]

type DagDefinitionAmendedMutationEvent = Extract<DagRunEvent, { readonly type: "dag.definition.amended" }> & {
  readonly definition: DagPersistedDefinition
  readonly nodes: readonly DagNode[]
  readonly edges: readonly DagEdge[]
  readonly waves: readonly DagWave[]
  readonly criticalPath: readonly DagNodeId[]
  readonly bottlenecks: readonly DagBottleneck[]
  readonly diagnostics: readonly DagDiagnostic[]
}

export function applyDagRunMutation(record: DagRunRecordV1, event: DagRunEvent): DagRunRecordV1 {
  if (isPausedDagEvent(event)) return applyPausedDagEvent(record, event)
  const paused = applyRunPause(record, event)
  if (paused !== undefined) return paused
  if (event.type === "dag.run.created") return { ...record, updatedAt: event.at }
  if (event.type === "dag.node.retried") {
    return {
      ...record,
      nodes: record.nodes.map((node) => {
        if (node.id !== event.nodeId) return node
        const { error: _error, resultArtifact: _resultArtifact, runStats: _runStats, completedAt: _completedAt, startedAt: _startedAt, output: _output, outputBytes: _outputBytes, ...kept } = node as DagNode & {
          readonly resultArtifact?: unknown
        }
        return { ...kept, state: "pending", execAttempt: event.execAttempt }
      }),
      updatedAt: event.at,
    }
  }
  if (event.type !== "dag.definition.amended") return record
  const mutation = event as DagDefinitionAmendedMutationEvent
  // This reducer runs as the journal's applyEvent, and the journal writes the WAL BEFORE applying it
  // (journal.ts appendPayload). Throwing from here would leave a durable event whose every replay
  // throws again, wedging the run permanently. So a precondition that no longer holds returns the
  // record UNCHANGED: replay stays idempotent, and amendRun below turns the unadvanced fingerprint
  // into the caller's typed refusal. amendRun re-checks all of these before appending, so reaching
  // one here means the run changed underneath a live amendment.
  if (record.definitionFingerprint !== event.previousFingerprint) return record
  const mutationNodeIds = new Set(mutation.nodes.map((node) => node.id))
  const removedNodeIds = record.nodes.filter((node) => !mutationNodeIds.has(node.id)).map((node) => node.id)
  const unsafeIds = [...event.changedNodeIds, ...removedNodeIds].filter((id) => {
    return pausedAmendmentUnsafe(record, id)
  })
  if (unsafeIds.length > 0) return record
  if (record.status === "running") return record
  if (record.status === "paused" && record.pause?.reason !== "user_stop" && liveLeaseHolder(record)) return record
  return {
    ...record,
    name: mutation.definition.name,
    definition: mutation.definition,
    definitionFingerprint: event.fingerprint,
    nodes: mutation.nodes,
    edges: mutation.edges,
    waves: mutation.waves,
    criticalPath: mutation.criticalPath,
    bottlenecks: mutation.bottlenecks,
    diagnostics: mutation.diagnostics,
    amendHistory: [...(record.amendHistory ?? []), {
      at: event.at,
      previousFingerprint: event.previousFingerprint,
      fingerprint: event.fingerprint,
      changedNodeIds: event.changedNodeIds,
      addedNodeIds: event.addedNodeIds,
      invalidatedNodeIds: event.invalidatedNodeIds,
    }],
    updatedAt: event.at,
  }
}
