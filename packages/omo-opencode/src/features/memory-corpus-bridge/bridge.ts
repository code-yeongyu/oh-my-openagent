import type { MemoryWorkItem } from "../claude-tasks/memory-work-item"
import type { PromotionCandidate } from "../memory-core/types"
import type { L3ToL2PromotionRequest } from "./types"

const MIN_DISTILLED_SUMMARY_LENGTH = 20
const MAX_TITLE_LENGTH = 80

export class L3CorpusBridgeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "L3CorpusBridgeError"
  }
}

export interface L3DocumentAction {
  workItemId: string
  project: string
  contentSessionId: string
  sourceDocument: string
  content?: string
  title?: string
  url?: string
  metadata: Record<string, unknown>
}

export function validateL3PromotionRequest(req: L3ToL2PromotionRequest): void {
  if (!req.distilled_summary || req.distilled_summary.trim().length < MIN_DISTILLED_SUMMARY_LENGTH) {
    throw new L3CorpusBridgeError(
      `distilled_summary must be at least ${MIN_DISTILLED_SUMMARY_LENGTH} chars. Never promote raw chunk content directly.`,
    )
  }
  if (!req.source_refs.source_document) {
    throw new L3CorpusBridgeError("source_refs.source_document is required for L3 provenance")
  }
  if (!req.source_refs.chunk_id) {
    throw new L3CorpusBridgeError("source_refs.chunk_id is required for L3 provenance")
  }
}

export function buildL3DocumentAction(workItem: MemoryWorkItem): L3DocumentAction {
  const sourceDocument = getRequiredPayloadString(workItem, "source_document")
  const content = getOptionalPayloadString(workItem, "content")

  return {
    workItemId: workItem.id,
    project: workItem.project,
    contentSessionId: workItem.contentSessionId,
    sourceDocument,
    content,
    title: getOptionalPayloadString(workItem, "title"),
    url: getOptionalPayloadString(workItem, "url"),
    metadata: {
      work_item_type: workItem.type,
      content_kind: workItem.contentKind,
      importance: workItem.importance,
      dedupe_key: workItem.dedupeKey,
    },
  }
}

export function l3ToPromotionCandidate(req: L3ToL2PromotionRequest): PromotionCandidate {
  validateL3PromotionRequest(req)

  return {
    source_memory_id: req.retrieval_result.chunk_id,
    source_kind: "corpus",
    source_refs: {
      ...req.source_refs,
      chunk_id: req.retrieval_result.chunk_id,
      source_document: req.retrieval_result.source_document,
      embedding_model: req.retrieval_result.embedding_model ?? "",
      retrieved_at: req.retrieval_result.retrieved_at,
    },
    raw_content: req.distilled_summary,
    proposed_type: req.proposed_type,
    proposed_title: req.distilled_summary.slice(0, MAX_TITLE_LENGTH),
    classifier_score: req.confidence,
    classifier_criteria_met: ["source_is_l3_corpus", "has_distilled_summary", "has_provenance"],
    promotion_origin: "L3",
  }
}

function getRequiredPayloadString(workItem: MemoryWorkItem, key: string): string {
  const value = getOptionalPayloadString(workItem, key)
  if (!value) {
    throw new L3CorpusBridgeError(`payload.${key} is required for L3 ingestion`)
  }
  return value
}

function getOptionalPayloadString(workItem: MemoryWorkItem, key: string): string | undefined {
  const value = workItem.payload[key]
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}
