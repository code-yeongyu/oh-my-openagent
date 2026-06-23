import type { CuratorDecision, CuratorResponse } from "./types"

const JSON_BLOCK_PATTERN = /```json\s*([\s\S]*?)\s*```/

export class CuratorResponseParseError extends Error {
  constructor(message: string, public readonly raw: string) {
    super(message)
    this.name = "CuratorResponseParseError"
  }
}

export function parseCuratorResponse(raw: string): CuratorResponse {
  const jsonText = extractJsonBlock(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch (err) {
    throw new CuratorResponseParseError(
      `Curator response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      raw,
    )
  }
  return validateResponse(parsed, raw)
}

function extractJsonBlock(raw: string): string {
  const fenced = JSON_BLOCK_PATTERN.exec(raw)
  if (fenced && fenced[1]) return fenced[1].trim()
  const trimmed = raw.trim()
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed
  throw new CuratorResponseParseError(
    "Curator response did not contain a fenced ```json block or bare JSON object",
    raw,
  )
}

function validateResponse(parsed: unknown, raw: string): CuratorResponse {
  if (!isRecord(parsed)) {
    throw new CuratorResponseParseError(
      "Curator response root is not an object",
      raw,
    )
  }
  const decisionsRaw = parsed.decisions
  if (!Array.isArray(decisionsRaw)) {
    throw new CuratorResponseParseError(
      "Curator response is missing a 'decisions' array",
      raw,
    )
  }
  const decisions: CuratorDecision[] = []
  for (const entry of decisionsRaw) {
    const decision = validateDecision(entry)
    if (decision) decisions.push(decision)
  }
  const summary = typeof parsed.summary === "string" ? parsed.summary : ""
  const warningsRaw = parsed.warnings
  const warnings = Array.isArray(warningsRaw)
    ? warningsRaw.filter((w): w is string => typeof w === "string")
    : []
  return { decisions, summary, warnings }
}

function validateDecision(entry: unknown): CuratorDecision | undefined {
  if (!isRecord(entry)) return undefined
  const action = entry.action
  if (typeof action !== "string") return undefined

  switch (action) {
    case "PROMOTE":
      return validatePromote(entry)
    case "DEMOTE":
      return validateDemote(entry)
    case "MERGE":
      return validateMerge(entry)
    case "SUPERSEDE":
      return validateSupersede(entry)
    case "TAG":
      return validateTag(entry)
    case "NOOP":
      return validateNoop(entry)
    default:
      return undefined
  }
}

function validatePromote(entry: Record<string, unknown>): CuratorDecision | undefined {
  const memoryId = stringField(entry, "memory_id")
  const targetTier = entry.target_tier
  const reason = stringField(entry, "reason")
  if (!memoryId || !reason) return undefined
  if (targetTier !== "L2" && targetTier !== "L3") return undefined
  return {
    action: "PROMOTE",
    memory_id: memoryId,
    target_tier: targetTier,
    reason,
  }
}

function validateDemote(entry: Record<string, unknown>): CuratorDecision | undefined {
  const memoryId = stringField(entry, "memory_id")
  const targetTier = entry.target_tier
  const reason = stringField(entry, "reason")
  if (!memoryId || !reason) return undefined
  if (targetTier !== "L1") return undefined
  return { action: "DEMOTE", memory_id: memoryId, target_tier: "L1", reason }
}

function validateMerge(entry: Record<string, unknown>): CuratorDecision | undefined {
  const keep = stringField(entry, "keep_memory_id")
  const reason = stringField(entry, "reason")
  const mergeIdsRaw = entry.merge_memory_ids
  if (!keep || !reason) return undefined
  if (!Array.isArray(mergeIdsRaw)) return undefined
  const mergeIds = mergeIdsRaw.filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  )
  if (mergeIds.length === 0) return undefined
  const canonicalSummary = typeof entry.canonical_summary === "string"
    ? entry.canonical_summary
    : undefined
  return {
    action: "MERGE",
    keep_memory_id: keep,
    merge_memory_ids: mergeIds,
    reason,
    ...(canonicalSummary ? { canonical_summary: canonicalSummary } : {}),
  }
}

function validateSupersede(entry: Record<string, unknown>): CuratorDecision | undefined {
  const newId = stringField(entry, "new_memory_id")
  const oldId = stringField(entry, "old_memory_id")
  const reason = stringField(entry, "reason")
  if (!newId || !oldId || !reason) return undefined
  return {
    action: "SUPERSEDE",
    new_memory_id: newId,
    old_memory_id: oldId,
    reason,
  }
}

function validateTag(entry: Record<string, unknown>): CuratorDecision | undefined {
  const memoryId = stringField(entry, "memory_id")
  const reason = stringField(entry, "reason")
  const patchRaw = entry.patch
  if (!memoryId || !reason || !isRecord(patchRaw)) return undefined
  const patch: { why_it_matters?: string; tags?: string[]; confidence?: number } = {}
  if (typeof patchRaw.why_it_matters === "string") {
    patch.why_it_matters = patchRaw.why_it_matters
  }
  if (Array.isArray(patchRaw.tags)) {
    patch.tags = patchRaw.tags.filter((t): t is string => typeof t === "string")
  }
  if (typeof patchRaw.confidence === "number") {
    const clamped = Math.max(0, Math.min(1, patchRaw.confidence))
    patch.confidence = clamped
  }
  if (Object.keys(patch).length === 0) return undefined
  return { action: "TAG", memory_id: memoryId, patch, reason }
}

function validateNoop(entry: Record<string, unknown>): CuratorDecision | undefined {
  const memoryId = stringField(entry, "memory_id")
  const reason = stringField(entry, "reason")
  if (!memoryId || !reason) return undefined
  return { action: "NOOP", memory_id: memoryId, reason }
}

function stringField(entry: Record<string, unknown>, key: string): string | undefined {
  const value = entry[key]
  if (typeof value === "string" && value.trim().length > 0) return value
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
