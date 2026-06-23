// Graph Memory — Mem0 Pro exclusive feature
// 26% relative improvement in LLM-as-a-Judge metric (ECAII 2025 paper)
// MNH-24: graph entities/relations are PROVIDER-SIDE only, never in canonical domain

export interface GraphMemoryConfig {
  enabled: boolean
  threshold: number
}

export interface GraphEntity {
  id: string
  name: string
  type: string
}

export interface GraphRelation {
  source: string
  target: string
  relationship: string
  source_type?: string
  target_type?: string
  score?: number
}

export interface GraphMemoryResult {
  entities: GraphEntity[]
  relations: GraphRelation[]
}

export const DEFAULT_GRAPH_CONFIG: GraphMemoryConfig = {
  enabled: true,
  threshold: 0.7,
}

/**
 * Extract graph memory data from a Mem0 search result.
 *
 * Returns null if graph data is not present (graph disabled or not a Pro account).
 * Result is kept provider-side — NEVER stored in CanonicalMemory.
 */
export function extractGraphData(rawResult: unknown): GraphMemoryResult | null {
  if (!rawResult || typeof rawResult !== "object") return null
  const r = rawResult as Record<string, unknown>
  const rawEntities = Array.isArray(r.entities) ? r.entities : []
  const rawRelations = Array.isArray(r.relations) ? r.relations : []
  if (rawEntities.length === 0 && rawRelations.length === 0) return null

  const entities: GraphEntity[] = rawEntities.map((e: unknown) => {
    const entity = (e ?? {}) as Record<string, unknown>
    return {
      id: String(entity.id ?? entity.name ?? ""),
      name: String(entity.name ?? ""),
      type: String(entity.type ?? "unknown"),
    }
  })

  const relations: GraphRelation[] = rawRelations.map((rel: unknown) => {
    const relation = (rel ?? {}) as Record<string, unknown>
    return {
      source: String(relation.source ?? ""),
      target: String(relation.target ?? ""),
      relationship: String(relation.relationship ?? ""),
      source_type: relation.source_type ? String(relation.source_type) : undefined,
      target_type: relation.target_type ? String(relation.target_type) : undefined,
      score: typeof relation.score === "number" ? relation.score : undefined,
    }
  })

  return { entities, relations }
}

/**
 * Build graph-aware Mem0 request parameters.
 * Adds enable_graph to the request payload when graph memory is enabled.
 *
 * Note: graph_threshold is a project-level setting configured via
 * client.project.update(), not a per-request parameter.
 */
export function buildGraphParams(config: GraphMemoryConfig): Record<string, unknown> {
  if (!config.enabled) return {}
  return {
    enable_graph: true,
  }
}
