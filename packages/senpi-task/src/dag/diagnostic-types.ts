// The run's diagnostics and the per-node record of a turn held while the user stopped the run.
import type { DagNodeId, DagRunId } from "./types"

/**
 * What a settled child's self-started turn was, as far as the manager knows it, when the fence held it
 * because the user had stopped the run (#11381). Carried by a `node_flag` diagnostic event; the
 * reducer folds it into the node's `heldTrigger` instead of the diagnostics list.
 */
export type DagHeldTriggerFact = { readonly taskId: string; readonly cause: string }

/** Bounded: one entry per node, the count and the first and last time, until the node is acted on. */
export type DagHeldTrigger = DagHeldTriggerFact & {
  readonly count: number
  readonly firstAt: string
  readonly lastAt: string
}

export type DagDiagnostic =
  | {
      readonly kind: "route_fallback"
      readonly nodeId: DagNodeId
      readonly message: string
      readonly at: string
    }
  | {
      readonly kind: "node_flag"
      readonly nodeId: DagNodeId
      // A dependent flagged because the node it consumed lost its result (#12134).
      readonly invalidatedBy?: DagNodeId
      readonly message: string
      readonly at: string
      readonly heldTrigger?: DagHeldTriggerFact
    }
  | {
      readonly kind: "missing_skill"
      readonly nodeId: DagNodeId
      readonly skill: string
      readonly message: string
      readonly at: string
    }
  | { readonly kind: "run_flag"; readonly message: string; readonly at: string }
  | {
      readonly kind: "journal_corrupt"
      readonly runId?: DagRunId
      readonly path: string
      readonly message: string
      readonly at: string
    }
