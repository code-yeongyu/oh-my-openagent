export type DagState = "pending" | "running" | "blocked" | "completed" | "failed"

export interface DagNodeSpec {
  readonly id: string
  readonly label: string
  /** Role or category that owns the node (planning, deep, writing …). */
  readonly category: string
  /** Model the node runs on; the scenario spreads these on purpose. */
  readonly model: string
  readonly dependsOn: readonly string[]
}

export interface DagNode extends DagNodeSpec {
  readonly state: DagState
  readonly activity?: string
  readonly startedAtMs?: number
  readonly finishedAtMs?: number
}

export interface DagWave {
  readonly index: number
  readonly nodeIds: readonly string[]
}

export interface DagEdge {
  readonly from: string
  readonly to: string
}

export type DagRunStatus = "pending" | "running" | "completed"

/** Mirror of the desktop app's ThreadDagRun, reduced to what the landing view renders. */
export interface DagRun {
  readonly name: string
  readonly status: DagRunStatus
  readonly nodes: readonly DagNode[]
  readonly waves: readonly DagWave[]
  readonly edges: readonly DagEdge[]
}
