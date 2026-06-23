import { randomUUID } from "node:crypto"
import type { CanonicalMemory, PromotionCandidate } from "../memory-core/types"
import type { MemoryCoreService } from "../memory-core/service"
import { classifyCandidate } from "./classifier"
import { InMemoryDedupStore, checkDedup } from "./dedup"
import { writeToOutbox } from "./outbox-writer"
import { buildProvenance } from "./provenance-builder"
import { DEFAULT_RULES, evaluateRules } from "./rules-engine"

export interface PipelineResult {
  promoted: number
  skipped_duplicate: number
  skipped_rules: number
  skipped_classifier: number
  errors: number
  memory_ids: string[]
}

export interface PipelineDeps {
  service: MemoryCoreService
  dedupStore?: {
    findByProvenance: typeof InMemoryDedupStore.prototype.findByProvenance
    findByContentHash: typeof InMemoryDedupStore.prototype.findByContentHash
    record: typeof InMemoryDedupStore.prototype.record
  }
}

export async function runPromotionPipeline(
  candidates: PromotionCandidate[],
  deps: PipelineDeps,
  options?: {
    project_id?: string
    promoted_by?: string
    provider_name?: string
  },
): Promise<PipelineResult> {
  const result: PipelineResult = {
    promoted: 0,
    skipped_duplicate: 0,
    skipped_rules: 0,
    skipped_classifier: 0,
    errors: 0,
    memory_ids: [],
  }

  const dedupStore = deps.dedupStore ?? new InMemoryDedupStore()
  const project_id = options?.project_id ?? "default"
  const promoted_by = options?.promoted_by ?? "memory-promotion-pipeline"
  const provider_name = options?.provider_name ?? "mem0"

  for (const candidate of candidates) {
    try {
      const rules_result = evaluateRules(candidate, DEFAULT_RULES)
      if (!rules_result.overall_pass) {
        result.skipped_rules++
        continue
      }

      const classification = classifyCandidate(candidate)
      if (classification.decision === "skip") {
        result.skipped_classifier++
        continue
      }

      const memory_id = randomUUID()
      const dedupResult = await checkDedup(
        {
          source_ref: candidate.source_refs.claude_mem_id ?? candidate.source_memory_id,
          promotion_origin: candidate.promotion_origin,
          raw_content: candidate.raw_content,
          memory_id,
        },
        dedupStore,
      )

      if (dedupResult.is_duplicate) {
        result.skipped_duplicate++
        continue
      }

      const provenance = buildProvenance({
        memory_id,
        candidate,
        classification,
        rules_result,
        promoted_by,
      })

      const now = new Date().toISOString()
      const memory: CanonicalMemory = {
        memory_id,
        project_id,
        memory_type: candidate.proposed_type,
        title: candidate.proposed_title,
        summary: candidate.raw_content.slice(0, 500),
        why_it_matters: `Promoted from L1 session observation (type: ${candidate.proposed_type})`,
        scope: project_id,
        evidence: candidate.classifier_criteria_met,
        tags: [candidate.proposed_type, "promoted-from-l1"],
        status: "active",
        confidence: candidate.classifier_score,
        source_kind: candidate.source_kind,
        source_refs: candidate.source_refs,
        created_by: promoted_by,
        created_at: now,
        updated_at: now,
        promotion_origin: candidate.promotion_origin,
        provider_name,
        provider_external_id: "",
        provider_payload_raw: { provenance },
      }

      void memory

      await writeToOutbox(
        {
          memory_id,
          provider_name,
          operation: "create",
        },
        {
          enqueueOutbox: async (entry) => {
            await deps.service.enqueueOutbox(entry).catch(() => {
              return undefined
            })
          },
        },
      )

      result.promoted++
      result.memory_ids.push(memory_id)
    } catch {
      result.errors++
    }
  }

  return result
}
