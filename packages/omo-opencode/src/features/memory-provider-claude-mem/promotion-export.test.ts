import { describe, expect, test } from "bun:test"
import { extractPromotionCandidates } from "./promotion-export"
import type { ClaudeMemSQLiteReader, PromotionCandidateOptions } from "./sqlite-reader"
import type { ObservationRow } from "./types"

function makeReader(
  handler: (options?: PromotionCandidateOptions) => ObservationRow[],
): ClaudeMemSQLiteReader {
  return {
    getPromotionCandidates: handler,
  } as unknown as ClaudeMemSQLiteReader
}

function makeObservation(overrides: Partial<ObservationRow> = {}): ObservationRow {
  return {
    id: 1,
    memory_session_id: "mem-1",
    project: "super-agent",
    text: null,
    type: "discovery",
    title: "Default observation",
    subtitle: null,
    facts: null,
    narrative: null,
    concepts: null,
    files_read: null,
    files_modified: null,
    prompt_number: null,
    discovery_tokens: 500,
    created_at: "2026-01-01T00:00:00Z",
    content_hash: "hash-abc",
    ...overrides,
  }
}

describe("extractPromotionCandidates", () => {
  describe("#given reader returns mixed observation types", () => {
    test("#when extracted #then only decision and discovery pass through", () => {
      const rows = [
        makeObservation({ id: 1, type: "decision" }),
        makeObservation({ id: 2, type: "discovery" }),
        makeObservation({ id: 3, type: "bugfix" }),
        makeObservation({ id: 4, type: "change" }),
      ]
      const reader = makeReader(() => rows)

      const candidates = extractPromotionCandidates(reader)

      expect(candidates).toHaveLength(2)
      expect(candidates.map((c) => c.source_memory_id)).toEqual(["1", "2"])
      expect(candidates.every((c) => c.proposed_type === "decision" || c.proposed_type === "discovery")).toBe(true)
    })
  })

  describe("#given observation with extreme discovery_tokens", () => {
    test("#when discovery_tokens = 5000 #then classifier_score clamps to 1", () => {
      const reader = makeReader(() => [
        makeObservation({ type: "decision", discovery_tokens: 5000 }),
      ])

      const candidates = extractPromotionCandidates(reader)

      expect(candidates[0]?.classifier_score).toBe(1)
    })

    test("#when discovery_tokens = 250 #then classifier_score = 0.25", () => {
      const reader = makeReader(() => [
        makeObservation({ type: "decision", discovery_tokens: 250 }),
      ])

      const candidates = extractPromotionCandidates(reader)

      expect(candidates[0]?.classifier_score).toBe(0.25)
    })

    test("#when discovery_tokens is null #then classifier_score = 0", () => {
      const reader = makeReader(() => [
        makeObservation({ type: "decision", discovery_tokens: null }),
      ])

      const candidates = extractPromotionCandidates(reader)

      expect(candidates[0]?.classifier_score).toBe(0)
    })
  })

  describe("#given min_discovery_tokens option", () => {
    test("#when helper called #then value forwarded to reader", () => {
      let received: PromotionCandidateOptions | undefined
      const reader = makeReader((opts) => {
        received = opts
        return []
      })

      extractPromotionCandidates(reader, { min_discovery_tokens: 300 })

      expect(received?.min_discovery_tokens).toBe(300)
    })

    test("#when not provided #then defaults to 100", () => {
      let received: PromotionCandidateOptions | undefined
      const reader = makeReader((opts) => {
        received = opts
        return []
      })

      extractPromotionCandidates(reader)

      expect(received?.min_discovery_tokens).toBe(100)
      expect(received?.limit).toBe(20)
    })
  })

  describe("#given observation with narrative and concepts", () => {
    test("#when extracted #then raw_content aggregates title narrative facts concepts", () => {
      const reader = makeReader(() => [
        makeObservation({
          type: "discovery",
          title: "Key finding",
          narrative: "Detailed walkthrough of what happened",
          facts: "Important fact surfaced",
          concepts: "core, architecture",
        }),
      ])

      const candidates = extractPromotionCandidates(reader)

      const raw = candidates[0]?.raw_content ?? ""
      expect(raw).toContain("# Key finding")
      expect(raw).toContain("Detailed walkthrough of what happened")
      expect(raw).toContain("Facts: Important fact surfaced")
      expect(raw).toContain("Concepts: core, architecture")
    })

    test("#when source_refs populated #then includes claude_mem_id and content_hash", () => {
      const reader = makeReader(() => [
        makeObservation({ id: 42, type: "decision", content_hash: "hash-42" }),
      ])

      const candidates = extractPromotionCandidates(reader)

      const refs = candidates[0]?.source_refs
      expect(refs?.claude_mem_id).toBe("42")
      expect(refs?.content_hash).toBe("hash-42")
      expect(refs?.project).toBe("super-agent")
    })
  })
})
