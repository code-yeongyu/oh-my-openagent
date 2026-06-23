import type { MemoryType, PromotionCandidate } from "../memory-core/types"
import type { L1PromotionCandidateOptions } from "../memory-provider-core/types"
import type { ClaudeMemSQLiteReader, PromotionCandidateOptions } from "./sqlite-reader"
import type { ObservationRow } from "./types"

const PROMOTABLE_TYPES = new Set<string>(["decision", "discovery"])

export function extractPromotionCandidates(
  reader: ClaudeMemSQLiteReader,
  options?: L1PromotionCandidateOptions,
): PromotionCandidate[] {
  const query: PromotionCandidateOptions = {
    project: options?.project,
    min_discovery_tokens: options?.min_discovery_tokens ?? 100,
    limit: options?.limit ?? 20,
    since: options?.since,
  }
  const rawCandidates = reader.getPromotionCandidates(query)

  return rawCandidates
    .filter((row) => PROMOTABLE_TYPES.has(row.type))
    .map(observationToCandidate)
}

function observationToCandidate(row: ObservationRow): PromotionCandidate {
  return {
    source_memory_id: String(row.id),
    source_kind: "session",
    source_refs: {
      claude_mem_id: String(row.id),
      memory_session_id: row.memory_session_id,
      project: row.project,
      content_hash: row.content_hash ?? "",
    },
    raw_content: buildRawContent(row),
    proposed_type: mapObservationType(row.type),
    proposed_title: row.title ?? "(untitled observation)",
    classifier_score: clampScore((row.discovery_tokens ?? 0) / 1000),
    classifier_criteria_met: buildCriteriaMet(row),
    promotion_origin: "L1",
  }
}

function mapObservationType(claudeMemType: string): MemoryType {
  if (claudeMemType === "decision") return "decision"
  if (claudeMemType === "discovery") return "discovery"
  return "discovery"
}

function clampScore(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

function buildRawContent(row: ObservationRow): string {
  const parts: string[] = []
  if (row.title) parts.push(`# ${row.title}`)
  if (row.subtitle) parts.push(row.subtitle)
  if (row.narrative) parts.push(row.narrative)
  if (row.facts) parts.push(`Facts: ${row.facts}`)
  if (row.concepts) parts.push(`Concepts: ${row.concepts}`)
  const combined = parts.join("\n\n")
  return combined || row.text || "(no content)"
}

function buildCriteriaMet(row: ObservationRow): string[] {
  const criteria: string[] = []
  if (PROMOTABLE_TYPES.has(row.type)) criteria.push("type_matches_promotable")
  if ((row.discovery_tokens ?? 0) >= 500) criteria.push("high_discovery_tokens")
  if (row.narrative) criteria.push("has_narrative")
  if (row.concepts) criteria.push("has_concepts")
  return criteria
}
