import type { MemoryType, SourceKind } from "../memory-core/types"
import type { MemoryWorkItem, MemoryWorkItemType } from "../claude-tasks/memory-work-item"
import type {
  CanonicalDraft,
  OutboxDraft,
  WorkItemCanonicalProjection,
  WorkItemCanonicalProjectionInput,
} from "./types"
import { memoryTargetToProviderName } from "./target-to-provider"

const DEFAULT_CONFIDENCE = 0.5
const DEFAULT_MEMORY_TYPE: MemoryType = "discovery"
const DEFAULT_SOURCE_KIND: SourceKind = "session"
const MAX_TITLE_LENGTH = 80
const MAX_SUMMARY_LENGTH = 400

export function projectWorkItemToCanonical(
  input: WorkItemCanonicalProjectionInput,
): WorkItemCanonicalProjection {
  const canonical = buildCanonicalDraft(input)
  const outbox = buildOutboxDrafts(input, canonical.memory_id)
  return { canonical, outbox }
}

function buildCanonicalDraft(input: WorkItemCanonicalProjectionInput): CanonicalDraft {
  const workItem = input.workItem
  const title = extractTitle(workItem)
  const summary = extractSummary(workItem)

  return {
    memory_id: input.memoryId,
    project_id: workItem.project,
    memory_type: mapMemoryType(workItem.type),
    title,
    summary,
    why_it_matters: extractWhyItMatters(workItem),
    scope: workItem.contentSessionId,
    evidence: extractEvidence(workItem),
    tags: extractTags(workItem),
    status: "pending_review",
    confidence: mapConfidence(workItem.importance),
    source_kind: mapSourceKind(workItem.source),
    source_refs: extractSourceRefs(workItem),
    created_by: input.actor,
    promotion_origin: "L1",
    provider_name: "canonical",
    provider_external_id: input.memoryId,
    provider_payload_raw: workItem.payload,
  }
}

function buildOutboxDrafts(
  input: WorkItemCanonicalProjectionInput,
  memoryId: string,
): OutboxDraft[] {
  const activeProviders = input.activeProviders
  const isProviderActive = (providerName: string): boolean =>
    activeProviders === undefined || activeProviders.has(providerName)

  const entries: OutboxDraft[] = input.targets
    .map((target) => ({
      outbox_id: `${memoryId}:${target}`,
      memory_id: memoryId,
      provider_name: memoryTargetToProviderName(target),
      operation: "create" as const,
      idempotency_key: `${input.workItem.dedupeKey}:${target}`,
      status: "pending" as const,
    }))
    .filter((entry) => isProviderActive(entry.provider_name))

  if (input.obsidianEnabled && isProviderActive("obsidian")) {
    entries.push({
      outbox_id: `${memoryId}:obsidian`,
      memory_id: memoryId,
      provider_name: "obsidian",
      operation: "create",
      idempotency_key: `${input.workItem.dedupeKey}:obsidian`,
      status: "pending",
    })
  }

  return entries
}

function extractTitle(workItem: MemoryWorkItem): string {
  const explicit = readStringField(workItem.payload, "title")
  if (explicit) return truncate(explicit, MAX_TITLE_LENGTH)
  return truncate(`${workItem.type}:${workItem.source}`, MAX_TITLE_LENGTH)
}

function extractSummary(workItem: MemoryWorkItem): string {
  const explicit = readStringField(workItem.payload, "summary")
  if (explicit) return truncate(explicit, MAX_SUMMARY_LENGTH)
  const content = readStringField(workItem.payload, "content")
  if (content) return truncate(content, MAX_SUMMARY_LENGTH)
  return truncate(`Work item ${workItem.id} of type ${workItem.type}`, MAX_SUMMARY_LENGTH)
}

function extractWhyItMatters(workItem: MemoryWorkItem): string {
  const explicit = readStringField(workItem.payload, "why_it_matters")
  if (explicit) return explicit
  return `Captured from ${workItem.source} with importance ${workItem.importance}`
}

function extractEvidence(workItem: MemoryWorkItem): string[] {
  const raw = workItem.payload.evidence
  if (Array.isArray(raw)) {
    return raw
      .map((item) => (typeof item === "string" ? item : undefined))
      .filter((item): item is string => typeof item === "string" && item.length > 0)
  }
  const url = readStringField(workItem.payload, "url")
  return url ? [url] : []
}

function extractTags(workItem: MemoryWorkItem): string[] {
  const raw = workItem.payload.tags
  if (Array.isArray(raw)) {
    return raw
      .map((item) => (typeof item === "string" ? item : undefined))
      .filter((item): item is string => typeof item === "string" && item.length > 0)
  }
  return [workItem.contentKind]
}

function extractSourceRefs(workItem: MemoryWorkItem): Record<string, string> {
  const refs: Record<string, string> = {
    work_item_id: workItem.id,
    source: workItem.source,
    session: workItem.contentSessionId,
    dedupe_key: workItem.dedupeKey,
  }
  const url = readStringField(workItem.payload, "url")
  if (url) refs.url = url
  const sourceDocument = readStringField(workItem.payload, "source_document")
  if (sourceDocument) refs.source_document = sourceDocument
  const toolName = readStringField(workItem.payload, "tool_name")
  if (toolName) refs.tool_name = toolName
  const callId = readStringField(workItem.payload, "call_id")
  if (callId) refs.call_id = callId
  return refs
}

function mapMemoryType(type: MemoryWorkItemType): MemoryType {
  switch (type) {
    case "document_candidate":
      return "discovery"
    case "promotion_candidate":
      return "decision"
    case "preference_candidate":
      return "convention"
    case "session_summary":
      return "discovery"
    case "tool_observation":
      return DEFAULT_MEMORY_TYPE
  }
}

function mapSourceKind(source: string): SourceKind {
  if (source.startsWith("corpus:")) return "corpus"
  if (source.startsWith("agent:")) return "agent"
  if (source.startsWith("manual:")) return "manual"
  return DEFAULT_SOURCE_KIND
}

function mapConfidence(importance: number): number {
  if (!Number.isFinite(importance)) return DEFAULT_CONFIDENCE
  if (importance <= 0) return 0
  if (importance >= 1) return 1
  return importance
}

function readStringField(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  if (typeof value === "string" && value.trim().length > 0) return value.trim()
  return undefined
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, limit - 1)}…`
}
