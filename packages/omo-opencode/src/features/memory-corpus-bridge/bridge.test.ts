import { describe, expect, it } from "bun:test"
import type { MemoryWorkItem } from "../claude-tasks/memory-work-item"
import {
  buildL3DocumentAction,
  L3CorpusBridgeError,
  l3ToPromotionCandidate,
  validateL3PromotionRequest,
} from "./bridge"
import type { L3ToL2PromotionRequest } from "./types"

function buildValidRequest(overrides: Partial<L3ToL2PromotionRequest> = {}): L3ToL2PromotionRequest {
  const base: L3ToL2PromotionRequest = {
    retrieval_result: {
      chunk_id: "chunk_abc",
      source_document: "doc_xyz.md",
      content: "raw chunk content that should never be promoted directly",
      score: 0.92,
      embedding_model: "text-embedding-3-small",
      retrieved_at: "2026-04-11T00:00:00.000Z",
    },
    distilled_summary: "Use exponential backoff with jitter for API retries to avoid thundering herd",
    why_it_matters: "Prevents cascading failures in rate-limited services",
    source_refs: {
      source_document: "doc_xyz.md",
      chunk_id: "chunk_abc",
    },
    proposed_type: "rule",
    confidence: 0.85,
  }
  return { ...base, ...overrides }
}

function buildDocumentWorkItem(overrides: Partial<MemoryWorkItem> = {}): MemoryWorkItem {
  return {
    id: "wi-doc-001",
    type: "document_candidate",
    source: "hook:Stop",
    project: "super-agent",
    contentSessionId: "ses_doc_001",
    candidateTargets: ["l3"],
    contentKind: "document",
    importance: 0.97,
    dedupeKey: "document_candidate:hook:Stop:ses_doc_001",
    payload: {
      source_document: "memory-plan.pdf",
      content: "%PDF-1.7 simulated content",
      title: "Memory plan",
      url: "https://example.com/memory-plan.pdf",
    },
    ...overrides,
  }
}

describe("memory-corpus-bridge", () => {
  describe("validateL3PromotionRequest", () => {
    describe("#given a valid request", () => {
      describe("#when validated", () => {
        it("#then does not throw", () => {
          const req = buildValidRequest()
          expect(() => validateL3PromotionRequest(req)).not.toThrow()
        })
      })
    })

    describe("#given a distilled_summary shorter than 20 chars", () => {
      describe("#when validated", () => {
        it("#then throws L3CorpusBridgeError", () => {
          const req = buildValidRequest({ distilled_summary: "too short" })
          expect(() => validateL3PromotionRequest(req)).toThrow(L3CorpusBridgeError)
        })
      })
    })

    describe("#given a distilled_summary that trims to empty", () => {
      describe("#when validated", () => {
        it("#then throws L3CorpusBridgeError", () => {
          const req = buildValidRequest({ distilled_summary: "                         " })
          expect(() => validateL3PromotionRequest(req)).toThrow(L3CorpusBridgeError)
        })
      })
    })

    describe("#given a distilled_summary that is purely whitespace", () => {
      describe("#when validated", () => {
        it("#then throws L3CorpusBridgeError", () => {
          const req = buildValidRequest({ distilled_summary: "   " })
          expect(() => validateL3PromotionRequest(req)).toThrow(L3CorpusBridgeError)
        })
      })
    })

    describe("#given source_refs.source_document is missing", () => {
      describe("#when validated", () => {
        it("#then throws L3CorpusBridgeError", () => {
          const req = buildValidRequest({
            source_refs: { chunk_id: "chunk_abc" },
          })
          expect(() => validateL3PromotionRequest(req)).toThrow(/source_document/)
        })
      })
    })

    describe("#given source_refs.chunk_id is missing", () => {
      describe("#when validated", () => {
        it("#then throws L3CorpusBridgeError", () => {
          const req = buildValidRequest({
            source_refs: { source_document: "doc.md" },
          })
          expect(() => validateL3PromotionRequest(req)).toThrow(/chunk_id/)
        })
      })
    })
  })

  describe("l3ToPromotionCandidate", () => {
    describe("#given a valid promotion request", () => {
      describe("#when converted", () => {
        it("#then returns a PromotionCandidate with source_kind=corpus", () => {
          const req = buildValidRequest()
          const candidate = l3ToPromotionCandidate(req)
          expect(candidate.source_kind).toBe("corpus")
        })

        it("#then returns a PromotionCandidate with promotion_origin=L3", () => {
          const req = buildValidRequest()
          const candidate = l3ToPromotionCandidate(req)
          expect(candidate.promotion_origin).toBe("L3")
        })

        it("#then uses chunk_id as source_memory_id", () => {
          const req = buildValidRequest()
          const candidate = l3ToPromotionCandidate(req)
          expect(candidate.source_memory_id).toBe("chunk_abc")
        })

        it("#then uses distilled_summary as raw_content (never the raw chunk)", () => {
          const req = buildValidRequest()
          const candidate = l3ToPromotionCandidate(req)
          expect(candidate.raw_content).toBe(req.distilled_summary)
          expect(candidate.raw_content).not.toBe(req.retrieval_result.content)
        })

        it("#then sets classifier_criteria_met with L3 provenance markers", () => {
          const req = buildValidRequest()
          const candidate = l3ToPromotionCandidate(req)
          expect(candidate.classifier_criteria_met).toContain("source_is_l3_corpus")
          expect(candidate.classifier_criteria_met).toContain("has_distilled_summary")
          expect(candidate.classifier_criteria_met).toContain("has_provenance")
        })

        it("#then preserves provenance metadata in source_refs", () => {
          const req = buildValidRequest()
          const candidate = l3ToPromotionCandidate(req)
          expect(candidate.source_refs.source_document).toBe("doc_xyz.md")
          expect(candidate.source_refs.chunk_id).toBe("chunk_abc")
          expect(candidate.source_refs.embedding_model).toBe("text-embedding-3-small")
          expect(candidate.source_refs.retrieved_at).toBe("2026-04-11T00:00:00.000Z")
        })

        it("#then truncates proposed_title to 80 chars", () => {
          const longSummary =
            "A very long distilled summary that exceeds the maximum title length constraint for memory candidates from L3"
          const req = buildValidRequest({ distilled_summary: longSummary })
          const candidate = l3ToPromotionCandidate(req)
          expect(candidate.proposed_title.length).toBeLessThanOrEqual(80)
        })

        it("#then uses confidence as classifier_score", () => {
          const req = buildValidRequest({ confidence: 0.73 })
          const candidate = l3ToPromotionCandidate(req)
          expect(candidate.classifier_score).toBe(0.73)
        })
      })
    })

    describe("#given an invalid promotion request", () => {
      describe("#when converted", () => {
        it("#then throws L3CorpusBridgeError (validation gate)", () => {
          const req = buildValidRequest({ distilled_summary: "nope" })
          expect(() => l3ToPromotionCandidate(req)).toThrow(L3CorpusBridgeError)
        })
      })
    })
  })

  describe("buildL3DocumentAction", () => {
    describe("#given a pdf document candidate work item", () => {
      describe("#when converted into an l3 action", () => {
        it("#then preserves the document payload and bridge metadata for ingestion", () => {
          const action = buildL3DocumentAction(buildDocumentWorkItem())

          expect(action).toEqual({
            workItemId: "wi-doc-001",
            project: "super-agent",
            contentSessionId: "ses_doc_001",
            sourceDocument: "memory-plan.pdf",
            content: "%PDF-1.7 simulated content",
            title: "Memory plan",
            url: "https://example.com/memory-plan.pdf",
            metadata: {
              work_item_type: "document_candidate",
              content_kind: "document",
              importance: 0.97,
              dedupe_key: "document_candidate:hook:Stop:ses_doc_001",
            },
          })
        })

        it("#then allows source-only document candidates without requiring inline content", () => {
          const action = buildL3DocumentAction(
            buildDocumentWorkItem({
              payload: {
                source_document: "memory-plan.pdf",
                title: "Memory plan",
                url: "https://example.com/memory-plan.pdf",
              },
            }),
          )

          expect(action).toEqual({
            workItemId: "wi-doc-001",
            project: "super-agent",
            contentSessionId: "ses_doc_001",
            sourceDocument: "memory-plan.pdf",
            content: undefined,
            title: "Memory plan",
            url: "https://example.com/memory-plan.pdf",
            metadata: {
              work_item_type: "document_candidate",
              content_kind: "document",
              importance: 0.97,
              dedupe_key: "document_candidate:hook:Stop:ses_doc_001",
            },
          })
        })
      })
    })
  })
})
