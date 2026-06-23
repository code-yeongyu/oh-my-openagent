import { z } from "zod"

import type { CanonicalMemory } from "./types"

const MemoryStatusSchema = z.enum(["active", "archived", "superseded", "pending_review"])
const SourceKindSchema = z.enum(["session", "corpus", "manual", "agent"])
const MemoryTypeSchema = z.enum(["decision", "discovery", "bugfix", "feature", "change", "rule", "convention", "benchmark"])
const PromotionOriginSchema = z.enum(["L1", "L3"])
const ConfidenceScoreSchema = z.number().min(0).max(1)

export const CanonicalMemorySchema = z.object({
  memory_id: z.string(),
  project_id: z.string(),
  memory_type: MemoryTypeSchema,
  title: z.string(),
  summary: z.string(),
  why_it_matters: z.string(),
  scope: z.string(),
  evidence: z.array(z.string()),
  tags: z.array(z.string()),
  status: MemoryStatusSchema,
  confidence: ConfidenceScoreSchema,
  source_kind: SourceKindSchema,
  source_refs: z.record(z.string(), z.string()),
  created_by: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  last_validated_at: z.string().optional(),
  promotion_origin: PromotionOriginSchema,
  provider_name: z.string(),
  provider_external_id: z.string(),
  provider_payload_raw: z.record(z.string(), z.unknown()).optional(),
  obsidian_path: z.string().optional(),
  related_entities: z.array(z.string()).optional(),
  supersedes: z.array(z.string()).optional(),
  superseded_by: z.string().optional(),
})

export const MemoryProvenanceSchema = z.object({
  memory_id: z.string(),
  source_kind: SourceKindSchema,
  source_refs: z.record(z.string(), z.string()),
  promotion_origin: PromotionOriginSchema,
  promoted_at: z.string(),
  promoted_by: z.string(),
  classifier_trace: z.array(z.string()),
})

export const MemorySupersedesSchema = z.object({
  memory_id: z.string(),
  superseded_memory_id: z.string(),
  reason: z.string(),
  superseded_at: z.string(),
})

export const ProviderCapabilitiesSchema = z.object({
  provider_name: z.string(),
  update: z.boolean(),
  delete: z.boolean(),
  rich_filters: z.boolean(),
  history: z.boolean(),
  graph: z.boolean(),
  batch: z.boolean(),
  webhooks: z.boolean(),
  export: z.boolean(),
  async_client: z.boolean(),
})

export const OutboxEntrySchema = z.object({
  outbox_id: z.string(),
  memory_id: z.string(),
  provider_name: z.string(),
  operation: z.enum(["create", "update", "delete"]),
  idempotency_key: z.string(),
  status: z.enum(["pending", "processing", "synced", "failed"]),
  created_at: z.string(),
  last_attempted_at: z.string().optional(),
  retry_count: z.number().int().min(0),
  error: z.string().optional(),
})

export const PromotionCandidateSchema = z.object({
  source_memory_id: z.string(),
  source_kind: SourceKindSchema,
  source_refs: z.record(z.string(), z.string()),
  raw_content: z.string(),
  proposed_type: MemoryTypeSchema,
  proposed_title: z.string(),
  classifier_score: z.number().min(0).max(1),
  classifier_criteria_met: z.array(z.string()),
  promotion_origin: PromotionOriginSchema,
})

export const SyncStateSchema = z.object({
  memory_id: z.string(),
  provider_name: z.string(),
  last_synced_at: z.string(),
  last_projected_sha256: z.string().optional(),
  sync_status: z.enum(["synced", "pending", "failed"]),
})

export const AuditLogEntrySchema = z.object({
  audit_id: z.string(),
  memory_id: z.string(),
  action: z.enum(["created", "updated", "promoted", "superseded", "archived", "synced", "projected"]),
  actor: z.string(),
  details: z.record(z.string(), z.unknown()),
  created_at: z.string(),
})

export function parseCanonicalMemory(input: unknown): { success: true; data: CanonicalMemory } | { success: false; error: z.ZodError } {
  const result = CanonicalMemorySchema.safeParse(input)

  if (result.success) {
    return { success: true, data: result.data }
  }

  return { success: false, error: result.error }
}
