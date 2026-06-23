export type MemoryStatus = "active" | "archived" | "superseded" | "pending_review"
export type SourceKind = "session" | "corpus" | "manual" | "agent"
export type MemoryType = "decision" | "discovery" | "bugfix" | "feature" | "change" | "rule" | "convention" | "benchmark"
export type PromotionOrigin = "L1" | "L3"
export type ConfidenceScore = number

export interface CanonicalMemory {
  memory_id: string
  project_id: string
  memory_type: MemoryType
  title: string
  summary: string
  why_it_matters: string
  scope: string
  evidence: string[]
  tags: string[]
  status: MemoryStatus
  confidence: ConfidenceScore
  source_kind: SourceKind
  source_refs: Record<string, string>
  created_by: string
  created_at: string
  updated_at: string
  last_validated_at?: string
  promotion_origin: PromotionOrigin
  provider_name: string
  provider_external_id: string
  provider_payload_raw?: Record<string, unknown>
  obsidian_path?: string
  related_entities?: string[]
  supersedes?: string[]
  superseded_by?: string
}

export interface MemoryProvenance {
  memory_id: string
  source_kind: SourceKind
  source_refs: Record<string, string>
  promotion_origin: PromotionOrigin
  promoted_at: string
  promoted_by: string
  classifier_trace: string[]
}

export interface MemorySupersedes {
  memory_id: string
  superseded_memory_id: string
  reason: string
  superseded_at: string
}

export interface ProviderCapabilities {
  provider_name: string
  update: boolean
  delete: boolean
  rich_filters: boolean
  history: boolean
  graph: boolean
  batch: boolean
  webhooks: boolean
  export: boolean
  async_client: boolean
}

export interface OutboxEntry {
  outbox_id: string
  memory_id: string
  provider_name: string
  operation: "create" | "update" | "delete"
  idempotency_key: string
  status: "pending" | "processing" | "synced" | "failed"
  created_at: string
  last_attempted_at?: string
  retry_count: number
  error?: string
}

export interface PromotionCandidate {
  source_memory_id: string
  source_kind: SourceKind
  source_refs: Record<string, string>
  raw_content: string
  proposed_type: MemoryType
  proposed_title: string
  classifier_score: number
  classifier_criteria_met: string[]
  promotion_origin: PromotionOrigin
}

export interface SyncState {
  memory_id: string
  provider_name: string
  last_synced_at: string
  last_projected_sha256?: string
  sync_status: "synced" | "pending" | "failed"
}

export interface AuditLogEntry {
  audit_id: string
  memory_id: string
  action: "created" | "updated" | "promoted" | "superseded" | "archived" | "synced" | "projected"
  actor: string
  details: Record<string, unknown>
  created_at: string
}
