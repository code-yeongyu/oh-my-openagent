import type { CanonicalMemory } from "../memory-core/types"
import type { L2SearchOptions, L2SearchResult } from "../memory-provider-core/types"
import type { Mem0AddRequest, Mem0Memory, Mem0SearchRequest } from "./types"

export function canonicalToMem0AddRequest(memory: CanonicalMemory): Mem0AddRequest {
  const userId = buildUserId(memory.project_id, memory.created_by)
  return {
    messages: [
      {
        role: "user",
        content: buildMemoryContent(memory),
      },
    ],
    user_id: userId,
    run_id: memory.source_refs.session_id,
    metadata: {
      memory_id: memory.memory_id,
      project_id: memory.project_id,
      memory_type: memory.memory_type,
      promotion_origin: memory.promotion_origin,
      source_kind: memory.source_kind,
    },
    infer: true,
    async_mode: true,
    enable_graph: true,
  }
}

export function mem0ToL2SearchResult(mem: Mem0Memory): L2SearchResult {
  const memoryIdRef = typeof mem.metadata?.memory_id === "string" ? mem.metadata.memory_id : undefined
  return {
    provider_external_id: mem.id,
    memory_id: memoryIdRef,
    content: mem.memory,
    score: mem.score ?? 0,
    metadata: {
      user_id: mem.user_id,
      memory_id_ref: memoryIdRef,
      created_at: mem.created_at,
    },
  }
}

export function buildMem0SearchRequest(
  query: string,
  projectId: string,
  userId?: string,
  options?: L2SearchOptions,
): Mem0SearchRequest {
  const effectiveUserId = options?.user_id ?? userId ?? `${projectId}:system`
  return {
    query,
    user_id: effectiveUserId,
    agent_id: options?.agent_id,
    run_id: options?.run_id,
    top_k: options?.limit ?? 10,
    threshold: options?.threshold,
    rerank: options?.rerank,
    keyword_search: options?.keyword_search,
    filter_memories: options?.filter_memories,
  }
}

export function buildUserId(projectId: string, createdBy: string): string {
  return `${projectId}:${createdBy}`
}

function buildMemoryContent(memory: CanonicalMemory): string {
  const lines: string[] = [
    `[${memory.memory_type.toUpperCase()}] ${memory.title}`,
    "",
    memory.summary,
    "",
    `Why it matters: ${memory.why_it_matters}`,
  ]
  if (memory.evidence.length > 0) {
    lines.push("", `Evidence: ${memory.evidence.join("; ")}`)
  }
  if (memory.tags.length > 0) {
    lines.push(`Tags: ${memory.tags.join(", ")}`)
  }
  return lines.join("\n")
}
