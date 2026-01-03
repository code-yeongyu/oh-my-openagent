import type { MemoryLayer, Memory, MemorySearchResult } from "./types"
import { Mem0Adapter } from "./adapter"

interface LayerManagerConfig {
  adapter: Mem0Adapter
  defaultLayer: MemoryLayer
}

export class MemoryLayerManager {
  private adapter: Mem0Adapter
  private defaultLayer: MemoryLayer
  private layerPriority: MemoryLayer[] = [
    "session",
    "user",
    "project",
    "org",
    "company",
  ]

  constructor(config: LayerManagerConfig) {
    this.adapter = config.adapter
    this.defaultLayer = config.defaultLayer
  }

  async addToLayer(
    content: string,
    layer?: MemoryLayer,
    metadata?: Record<string, unknown>
  ): Promise<Memory> {
    return this.adapter.add({
      content,
      layer: layer ?? this.defaultLayer,
      metadata,
    })
  }

  async searchAcrossLayers(
    query: string,
    options?: {
      layers?: MemoryLayer[]
      limit?: number
      threshold?: number
    }
  ): Promise<MemorySearchResult[]> {
    return this.adapter.search({
      query,
      layer: options?.layers ?? this.layerPriority,
      limit: options?.limit,
      threshold: options?.threshold,
    })
  }

  async searchLayer(
    query: string,
    layer: MemoryLayer,
    limit?: number
  ): Promise<MemorySearchResult[]> {
    return this.adapter.search({
      query,
      layer,
      limit,
    })
  }

  async getLayerMemories(layer: MemoryLayer): Promise<Memory[]> {
    return this.adapter.getAll(layer)
  }

  async getMergedContext(
    query: string,
    options?: {
      maxTokens?: number
      limit?: number
    }
  ): Promise<string> {
    const results = await this.searchAcrossLayers(query, {
      limit: options?.limit ?? 10,
    })

    if (results.length === 0) {
      return ""
    }

    const groupedByLayer = new Map<MemoryLayer, MemorySearchResult[]>()
    for (const result of results) {
      const existing = groupedByLayer.get(result.memory.layer) ?? []
      existing.push(result)
      groupedByLayer.set(result.memory.layer, existing)
    }

    const parts: string[] = []

    for (const layer of this.layerPriority.slice().reverse()) {
      const layerResults = groupedByLayer.get(layer)
      if (!layerResults?.length) continue

      const layerContent = layerResults
        .map((r) => `- ${r.memory.content}`)
        .join("\n")

      parts.push(`## ${this.formatLayerName(layer)} Context\n${layerContent}`)
    }

    return parts.join("\n\n")
  }

  async promoteMemory(id: string, targetLayer: MemoryLayer): Promise<Memory> {
    const existing = await this.adapter.get(id)
    if (!existing) {
      throw new Error(`Memory not found: ${id}`)
    }

    const currentPriority = this.layerPriority.indexOf(existing.layer)
    const targetPriority = this.layerPriority.indexOf(targetLayer)

    if (targetPriority <= currentPriority) {
      throw new Error(
        `Cannot promote from ${existing.layer} to ${targetLayer}`
      )
    }

    const newMemory = await this.adapter.add({
      content: existing.content,
      layer: targetLayer,
      metadata: {
        ...existing.metadata,
        promotedFrom: existing.id,
        promotedFromLayer: existing.layer,
      },
    })

    return newMemory
  }

  async clearLayer(layer: MemoryLayer): Promise<number> {
    const memories = await this.adapter.getAll(layer)
    let deleted = 0

    for (const memory of memories) {
      await this.adapter.delete(memory.id)
      deleted++
    }

    return deleted
  }

  async clearSession(): Promise<number> {
    return this.clearLayer("session")
  }

  private formatLayerName(layer: MemoryLayer): string {
    return layer.charAt(0).toUpperCase() + layer.slice(1)
  }
}
