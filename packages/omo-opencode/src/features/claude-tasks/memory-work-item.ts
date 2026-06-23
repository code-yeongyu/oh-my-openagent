export type MemoryTarget = "l1" | "l2" | "l3"

export type MemoryWorkItemType =
  | "tool_observation"
  | "session_summary"
  | "preference_candidate"
  | "document_candidate"
  | "promotion_candidate"

export interface MemoryWorkItem {
  id: string
  type: MemoryWorkItemType
  source: string
  project: string
  contentSessionId: string
  candidateTargets: MemoryTarget[]
  contentKind: string
  importance: number
  dedupeKey: string
  payload: Record<string, unknown>
}

export function buildMemoryWorkItemDedupeKey(
  type: MemoryWorkItemType,
  source: string,
  contentSessionId: string,
  discriminator?: string,
): string {
  return [type, source, contentSessionId, discriminator]
    .filter((segment): segment is string => typeof segment === "string" && segment.length > 0)
    .join(":")
}
