export type CuratorActionType =
  | "PROMOTE"
  | "DEMOTE"
  | "MERGE"
  | "SUPERSEDE"
  | "TAG"
  | "NOOP"

export interface PromoteDecision {
  action: "PROMOTE"
  memory_id: string
  target_tier: "L2" | "L3"
  reason: string
}

export interface DemoteDecision {
  action: "DEMOTE"
  memory_id: string
  target_tier: "L1"
  reason: string
}

export interface MergeDecision {
  action: "MERGE"
  keep_memory_id: string
  merge_memory_ids: string[]
  reason: string
  canonical_summary?: string
}

export interface SupersedeDecision {
  action: "SUPERSEDE"
  new_memory_id: string
  old_memory_id: string
  reason: string
}

export interface TagDecision {
  action: "TAG"
  memory_id: string
  patch: {
    why_it_matters?: string
    tags?: string[]
    confidence?: number
  }
  reason: string
}

export interface NoopDecision {
  action: "NOOP"
  memory_id: string
  reason: string
}

export type CuratorDecision =
  | PromoteDecision
  | DemoteDecision
  | MergeDecision
  | SupersedeDecision
  | TagDecision
  | NoopDecision

export interface CuratorResponse {
  decisions: CuratorDecision[]
  summary: string
  warnings: string[]
}

export interface CuratorApplyResult {
  applied: CuratorDecision[]
  skipped: Array<{ decision: CuratorDecision; reason: string }>
  failed: Array<{ decision: CuratorDecision; error: string }>
}
