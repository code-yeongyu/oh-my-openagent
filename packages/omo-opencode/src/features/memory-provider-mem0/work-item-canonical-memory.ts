import type { MemoryWorkItem } from "../claude-tasks/memory-work-item"
import type { CanonicalMemory } from "../memory-core/types"

export function buildCanonicalMemoryFromWorkItem(
  workItem: MemoryWorkItem,
  providerName: string,
): CanonicalMemory {
  const now = new Date().toISOString()
  const summary = getWorkItemSummary(workItem)

  return {
    memory_id: workItem.id,
    project_id: workItem.project,
    memory_type: workItem.type === "preference_candidate" ? "convention" : "discovery",
    title: summary.slice(0, 80),
    summary,
    why_it_matters: summary,
    scope: workItem.contentKind,
    evidence: [summary],
    tags: [workItem.contentKind, workItem.type],
    status: "active",
    confidence: workItem.importance,
    source_kind: workItem.type === "document_candidate" ? "corpus" : "session",
    source_refs: {
      session_id: workItem.contentSessionId,
      content_session_id: workItem.contentSessionId,
      dedupe_key: workItem.dedupeKey,
    },
    created_by: workItem.source,
    created_at: now,
    updated_at: now,
    promotion_origin: "L1",
    provider_name: providerName,
    provider_external_id: "pending",
    provider_payload_raw: workItem.payload,
  }
}

function getWorkItemSummary(workItem: MemoryWorkItem): string {
  const summaryKeys = ["summary", "fact", "preference", "content", "text"]
  for (const key of summaryKeys) {
    const value = workItem.payload[key]
    if (typeof value === "string" && value.trim().length > 0) {
      return value
    }
  }

  return `${workItem.type} recorded from ${workItem.source}`
}
