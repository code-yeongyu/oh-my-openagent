import type { MemoryTarget, MemoryWorkItem } from "../claude-tasks/memory-work-item"
import type { CanonicalMemory, OutboxEntry } from "../memory-core/types"

export type CanonicalDraft = Omit<CanonicalMemory, "created_at" | "updated_at">

export interface OutboxDraft extends Omit<OutboxEntry, "created_at" | "retry_count"> {}

export interface WorkItemCanonicalProjection {
  canonical: CanonicalDraft
  outbox: OutboxDraft[]
}

export interface WorkItemCanonicalProjectionInput {
  workItem: MemoryWorkItem
  targets: MemoryTarget[]
  obsidianEnabled: boolean
  memoryId: string
  actor: string
  activeProviders?: ReadonlySet<string>
}
