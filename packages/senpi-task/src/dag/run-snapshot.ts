import type { DagRunRecordV1 } from "./manager"
import { countDagNodes as countNodes } from "./counts"
import { readDagNodeActivityAt } from "./node-activity"
import type { DagNode, DagNodeState, DagRunSnapshot } from "./types"

// States whose node still owns a child that could be doing work right now. The activity clock is
// projected for exactly these, so a settled node never reports a stale "last seen" time.
const LIVE_CHILD_NODE_STATES: ReadonlySet<DagNodeState> = new Set(["scheduled", "running", "paused"])

function withNodeActivity(nodes: readonly DagNode[], stateDir: string): readonly DagNode[] {
  return nodes.map((node) => {
    if (node.taskId === undefined || !LIVE_CHILD_NODE_STATES.has(node.state)) return node
    const lastActivityAt = readDagNodeActivityAt(stateDir, node.taskId)
    return lastActivityAt === undefined ? node : { ...node, lastActivityAt }
  })
}

export function projectSnapshot(record: DagRunRecordV1, stateDir: string): DagRunSnapshot {
  return {
    ...(record.pause === undefined ? {} : { pause: record.pause }),
    schemaVersion: 1,
    runId: record.runId,
    runKey: record.runKey,
    name: record.name,
    parentSessionId: record.parentSessionId,
    rootSessionId: record.rootSessionId,
    status: record.status,
    generation: record.generation,
    createdAt: record.createdAt,
    ...(record.startedAt === undefined ? {} : { startedAt: record.startedAt }),
    ...(record.completedAt === undefined ? {} : { completedAt: record.completedAt }),
    definitionFingerprint: record.definitionFingerprint,
    lastSeq: record.checkpointSeq,
    nodes: withNodeActivity(record.nodes, stateDir),
    edges: record.edges,
    waves: record.waves,
    criticalPath: record.criticalPath,
    bottlenecks: record.bottlenecks,
    diagnostics: record.diagnostics,
    counts: countNodes(record.nodes),
    ...(record.amendHistory === undefined ? {} : { amendHistory: record.amendHistory }),
    ...(record.leaseHolderPid === undefined ? {} : { leaseHolderPid: record.leaseHolderPid }),
  }
}
