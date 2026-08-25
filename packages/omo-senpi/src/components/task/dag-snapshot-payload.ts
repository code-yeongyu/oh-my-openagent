// Structural read-seam over DagRunSnapshot/DagRunSummary: the bridge reads exactly the fields it
// puts on the wire, so the engine keeps ownership of the full snapshot type.
// The engine's DagNodeError also carries nodeId/at; this seam reads only what a viewer renders and
// the payload projects exactly those two fields, so the extras never reach the wire.
export interface DagBridgeSnapshotNodeError {
  readonly code: string
  readonly message: string
  readonly [extra: string]: unknown
}

export interface DagBridgeSnapshotNode {
  readonly id: string
  readonly label?: string
  readonly prompt: string
  readonly dependsOn: readonly string[]
  readonly state: string
  readonly taskId?: string
  readonly attempt: number
  readonly createdAt: string
  readonly startedAt?: string
  readonly completedAt?: string
  // The failure of the LAST settled attempt. A retry clears it when the node runs again.
  readonly error?: DagBridgeSnapshotNodeError
}

export interface DagBridgeSnapshotEdge {
  readonly from: string
  readonly to: string
}

export interface DagBridgeSnapshotWave {
  readonly index: number
  readonly nodeIds: readonly string[]
}

export interface DagBridgeRunSnapshot {
  readonly runId: string
  readonly runKey: string
  readonly name: string
  readonly status: string
  readonly createdAt: string
  readonly updatedAt: string
  // Absent while the run is live: a resumed run clears it, so the wire must be able to drop it too.
  readonly completedAt?: string
  readonly counts: Readonly<Record<string, number>>
  readonly nodes: readonly DagBridgeSnapshotNode[]
  readonly edges: readonly DagBridgeSnapshotEdge[]
  readonly waves: readonly DagBridgeSnapshotWave[]
  // One entry per accepted amendment; only the count reaches the wire.
  readonly amendHistory?: readonly unknown[]
}

export const DAG_MAX_RUN_SNAPSHOTS = 256

// The omo.dag.updated body: a wholesale replace, never a delta, so the whole owned run set goes out
// on every changed flush. `truncated_runs` stays absent while the set fits under the cap.
export function dagUpdatedPayload(parentSessionId: string, runs: readonly DagBridgeRunSnapshot[]) {
  const truncatedRuns = Math.max(0, runs.length - DAG_MAX_RUN_SNAPSHOTS)
  return {
    parent_session_id: parentSessionId,
    runs: (truncatedRuns === 0 ? runs : runs.slice(0, DAG_MAX_RUN_SNAPSHOTS)).map(runSnapshotPayload),
    ...(truncatedRuns === 0 ? {} : { truncated_runs: truncatedRuns }),
  }
}

// snake_case is the wire contract omo-desktop-app already consumes for omo.task.updated; optional
// engine fields stay absent rather than serializing as null.
function runSnapshotPayload(run: DagBridgeRunSnapshot) {
  const amendCount = run.amendHistory?.length ?? 0
  return {
    run_id: run.runId,
    run_key: run.runKey,
    name: run.name,
    status: run.status,
    created_at: run.createdAt,
    updated_at: run.updatedAt,
    ...(run.completedAt === undefined ? {} : { completed_at: run.completedAt }),
    counts: run.counts,
    nodes: run.nodes.map((node) => ({
      id: node.id,
      ...(node.label === undefined ? {} : { label: node.label }),
      prompt: node.prompt,
      depends_on: node.dependsOn,
      state: node.state,
      attempt: node.attempt,
      created_at: node.createdAt,
      ...(node.taskId === undefined ? {} : { task_id: node.taskId }),
      ...(node.startedAt === undefined ? {} : { started_at: node.startedAt }),
      ...(node.completedAt === undefined ? {} : { completed_at: node.completedAt }),
      ...(node.error === undefined ? {} : { last_error: { code: node.error.code, message: node.error.message } }),
    })),
    edges: run.edges.map((edge) => ({ from: edge.from, to: edge.to })),
    waves: run.waves.map((wave) => ({ index: wave.index, node_ids: wave.nodeIds })),
    ...(amendCount === 0 ? {} : { amend_count: amendCount }),
  }
}
