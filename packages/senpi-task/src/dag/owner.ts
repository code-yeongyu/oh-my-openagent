import type { StartResult } from "../manager/types"
import type { ResolvedModelRecord, TaskStatus } from "../state/types"
import type { DagNodeId, DagRunId } from "./types"

export type DagOwnerFingerprintInput = {
  readonly definitionFingerprint: string
  readonly nodeId: DagNodeId
  readonly execAttempt?: number
}

export type DagTaskOwner = {
  readonly kind: "dag"
  readonly runId: DagRunId
  readonly nodeId: DagNodeId
  readonly fingerprint: string
  /**
   * The node's execAttempt the task was created for (absent on records written before #11381, read
   * through fingerprint evidence by `owned-attempt.ts`). Adoption of a live task is bound to it: a
   * task of an earlier attempt belongs to a replaced definition and is disposed, never attached.
   */
  readonly execAttempt?: number
}

export type DagTaskOwnerKey = Pick<DagTaskOwner, "kind" | "runId" | "nodeId">
/** An owner key, a whole run when the node is omitted, or every DAG-owned task when the run is omitted too. */
export type DagTaskOwnerScope = Pick<DagTaskOwner, "kind"> & { readonly runId?: DagRunId; readonly nodeId?: DagNodeId }

type ReusedOwnedStart = {
  readonly kind: "started"
  readonly reused: true
  readonly task_id: string
  readonly status: TaskStatus
  readonly name: string
  readonly resolved_model?: ResolvedModelRecord
}

type FreshOwnedStart = Extract<StartResult, { readonly kind: "started" }> & {
  readonly reused: false
}

export type OwnedStartResult =
  | FreshOwnedStart
  | ReusedOwnedStart
  | Exclude<StartResult, { readonly kind: "started" }>
  | {
      readonly kind: "owner_conflict"
      readonly task_id: string
      readonly existing_fingerprint: string
      readonly requested_fingerprint: string
    }
