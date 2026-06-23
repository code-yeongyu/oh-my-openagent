import { describe, expect, test } from "bun:test"
import type { MemoryCoreService } from "../memory-core/service"
import type { PromotionCandidate } from "../memory-core/types"
import { classifyCandidate } from "./classifier"
import { computeContentHash, InMemoryDedupStore, checkDedup } from "./dedup"
import { runPromotionPipeline } from "./pipeline"
import { evaluateRules } from "./rules-engine"

function createCandidate(overrides: Partial<PromotionCandidate> = {}): PromotionCandidate {
  return {
    source_memory_id: "obs-1",
    source_kind: "session",
    source_refs: {
      claude_mem_id: "cm-1",
      content_hash: "hash-1",
    },
    raw_content:
      "Decided to normalize promotion candidates through a shared canonical pipeline for reuse across sessions.",
    proposed_type: "decision",
    proposed_title: "Use canonical promotion pipeline",
    classifier_score: 0.7,
    classifier_criteria_met: [
      "type_matches_promotable",
      "high_discovery_tokens",
      "has_narrative",
      "has_concepts",
    ],
    promotion_origin: "L1",
    ...overrides,
  }
}

describe("memory promotion pipeline", () => {
  describe("#given classifyCandidate", () => {
    test("#when candidate is strong #then returns promote", () => {
      const result = classifyCandidate(createCandidate())

      expect(result.decision).toBe("promote")
      expect(result.criteria_met_count).toBeGreaterThanOrEqual(1)
      expect(result.score).toBeGreaterThanOrEqual(0.1)
    })

    test("#when candidate is weak #then returns skip", () => {
      const result = classifyCandidate(
        createCandidate({
          source_memory_id: "weak-1",
          source_refs: {},
          raw_content: "Tiny note",
          proposed_type: "bugfix",
          classifier_criteria_met: [],
          classifier_score: 0,
        }),
      )

      expect(result.decision).toBe("skip")
      expect(result.criteria_met_count).toBe(0)
      expect(result.score).toBe(0)
    })
  })

  describe("#given evaluateRules", () => {
    test("#when type is not allowlisted #then fails type_allowlist rule", () => {
      const result = evaluateRules(
        createCandidate({
          proposed_type: "bugfix",
        }),
      )

      expect(result.overall_pass).toBeFalse()
      expect(result.rules_failed).toContain("type_allowlist")
      expect(
        result.trace.find((entry) => entry.rule === "type_allowlist")?.reason,
      ).toContain("not in the allowlist")
    })

    test("#when type is decision or discovery #then passes rules", () => {
      const decisionResult = evaluateRules(createCandidate({ proposed_type: "decision" }))
      const discoveryResult = evaluateRules(
        createCandidate({
          source_memory_id: "obs-2",
          proposed_type: "discovery",
        }),
      )

      expect(decisionResult.overall_pass).toBeTrue()
      expect(discoveryResult.overall_pass).toBeTrue()
    })
  })

  describe("#given checkDedup", () => {
    test("#when same provenance is checked twice #then second result is duplicate", async () => {
      const store = new InMemoryDedupStore()

      const first = await checkDedup(
        {
          source_ref: "cm-1",
          promotion_origin: "L1",
          raw_content: "Canonical pipeline promotion content",
          memory_id: "memory-1",
        },
        store,
      )

      const second = await checkDedup(
        {
          source_ref: "cm-1",
          promotion_origin: "L1",
          raw_content: "Canonical pipeline promotion content",
          memory_id: "memory-2",
        },
        store,
      )

      expect(first.is_duplicate).toBeFalse()
      expect(second.is_duplicate).toBeTrue()
      expect(second.matched_memory_id).toBe("memory-1")
    })
  })

  describe("#given computeContentHash", () => {
    test("#when content differs only by whitespace and casing #then hash matches", () => {
      const hashA = computeContentHash("Canonical   Promotion PIPELINE")
      const hashB = computeContentHash("  canonical promotion pipeline  ")

      expect(hashA).toBe(hashB)
      expect(hashA).toHaveLength(16)
    })
  })

  describe("#given runPromotionPipeline", () => {
    test("#when duplicate candidates are processed #then promotes once and skips duplicate", async () => {
      const enqueued: Array<{ memory_id: string; provider_name: string; operation: string }> = []
      const service = {
        enqueueOutbox: async (entry: {
          memory_id: string
          provider_name: string
          operation: "create" | "update" | "delete"
          outbox_id: string
          idempotency_key: string
          status: "pending" | "processing" | "synced" | "failed"
          last_attempted_at?: string
          error?: string
        }) => {
          enqueued.push({
            memory_id: entry.memory_id,
            provider_name: entry.provider_name,
            operation: entry.operation,
          })
        },
      } as Pick<MemoryCoreService, "enqueueOutbox">

      const result = await runPromotionPipeline(
        [
          createCandidate({
            source_memory_id: "obs-pipeline-1",
            source_refs: { claude_mem_id: "same-source", content_hash: "hash-1" },
          }),
          createCandidate({
            source_memory_id: "obs-pipeline-2",
            source_refs: { claude_mem_id: "same-source", content_hash: "hash-2" },
          }),
        ],
        {
          service: service as MemoryCoreService,
          dedupStore: new InMemoryDedupStore(),
        },
        {
          project_id: "project-1",
          promoted_by: "test-runner",
          provider_name: "mem0",
        },
      )

      expect(result.promoted).toBe(1)
      expect(result.skipped_duplicate).toBe(1)
      expect(result.skipped_rules).toBe(0)
      expect(result.skipped_classifier).toBe(0)
      expect(result.errors).toBe(0)
      expect(result.memory_ids).toHaveLength(1)
      expect(enqueued).toHaveLength(1)
      expect(enqueued[0]?.memory_id).toBe(result.memory_ids[0])
      expect(enqueued[0]?.provider_name).toBe("mem0")
      expect(enqueued[0]?.operation).toBe("create")
    })
  })
})
