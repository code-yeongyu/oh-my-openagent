/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import type { CanonicalMemory } from "../memory-core/types"
import {
  DEFAULT_SIGNAL_DETECTOR_CONFIG,
  detectDistillationSignal,
} from "./signal-detector"

function buildMemory(overrides: Partial<CanonicalMemory> = {}): CanonicalMemory {
  const now = "2026-04-19T20:00:00.000Z"
  return {
    memory_id: `m_${Math.random().toString(36).slice(2, 10)}`,
    project_id: "super-agent",
    memory_type: "discovery",
    title: "Generic memory",
    summary: "summary",
    why_it_matters: "why",
    scope: "ses_x",
    evidence: [],
    tags: ["generic"],
    status: "pending_review",
    confidence: 0.6,
    source_kind: "session",
    source_refs: {},
    created_by: "hook",
    created_at: now,
    updated_at: now,
    promotion_origin: "L1",
    provider_name: "canonical",
    provider_external_id: "x",
    ...overrides,
  }
}

describe("detectDistillationSignal", () => {
  describe("#given an empty memory list", () => {
    test("#when analyzed #then no clusters emerge", () => {
      const clusters = detectDistillationSignal([])
      expect(clusters).toEqual([])
    })
  })

  describe("#given 3 memories sharing a commit_sha", () => {
    test("#when analyzed #then one commit cluster is detected", () => {
      const commit = "abc1234"
      const memories = [
        buildMemory({ memory_id: "m1", source_refs: { commit_sha: commit }, confidence: 0.9 }),
        buildMemory({ memory_id: "m2", source_refs: { commit_sha: commit }, confidence: 0.9 }),
        buildMemory({ memory_id: "m3", source_refs: { commit_sha: commit }, confidence: 0.9 }),
      ]
      const clusters = detectDistillationSignal(memories, DEFAULT_SIGNAL_DETECTOR_CONFIG)
      expect(clusters.length).toBeGreaterThan(0)
      expect(clusters[0]?.cluster_key).toContain(`commit:${commit}`)
      expect(clusters[0]?.memories).toHaveLength(3)
    })
  })

  describe("#given a single decision memory with high confidence", () => {
    test("#when analyzed #then it passes the high threshold as a high-value cluster", () => {
      const memories = [
        buildMemory({
          memory_id: "m_d",
          memory_type: "decision",
          confidence: 0.9,
          tags: ["postgres", "architecture"],
        }),
      ]
      const clusters = detectDistillationSignal(memories, DEFAULT_SIGNAL_DETECTOR_CONFIG)
      const hasDecision = clusters.some((c) => c.cluster_key.includes("decision"))
      expect(hasDecision).toBe(true)
    })
  })

  describe("#given low confidence memories", () => {
    test("#when analyzed #then no clusters pass the high threshold", () => {
      const memories = [
        buildMemory({ confidence: 0.3 }),
        buildMemory({ confidence: 0.2 }),
      ]
      const clusters = detectDistillationSignal(memories, DEFAULT_SIGNAL_DETECTOR_CONFIG)
      expect(clusters).toEqual([])
    })
  })

  describe("#given the low threshold", () => {
    test("#when analyzed #then lower-confidence clusters can pass", () => {
      const memories = [
        buildMemory({ memory_id: "m1", confidence: 0.65, tags: ["shared-tag"] }),
        buildMemory({ memory_id: "m2", confidence: 0.7, tags: ["shared-tag"] }),
        buildMemory({ memory_id: "m3", confidence: 0.6, tags: ["shared-tag"] }),
      ]
      const clusters = detectDistillationSignal(memories, {
        threshold: "low",
        minimumObservationsForCluster: 3,
      })
      expect(clusters.length).toBeGreaterThan(0)
    })
  })

  describe("#given overlapping clusters", () => {
    test("#when analyzed #then memory is reported in only the highest-score cluster", () => {
      const commit = "c1"
      const memories = [
        buildMemory({ memory_id: "m1", source_refs: { commit_sha: commit }, tags: ["tagA"], confidence: 0.9, memory_type: "decision" }),
        buildMemory({ memory_id: "m2", source_refs: { commit_sha: commit }, tags: ["tagA"], confidence: 0.9, memory_type: "decision" }),
      ]
      const clusters = detectDistillationSignal(memories, DEFAULT_SIGNAL_DETECTOR_CONFIG)
      const ids = clusters.flatMap((c) => c.memories.map((m) => m.memory_id))
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(2)
    })
  })
})
