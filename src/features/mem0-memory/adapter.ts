import type {
  Memory,
  MemorySearchResult,
  AddMemoryInput,
  SearchMemoryInput,
  UpdateMemoryInput,
  Mem0Config,
  MemoryStats,
  MemoryLayer,
} from "./types"

const DEFAULT_ENDPOINT = "https://api.mem0.ai/v1"

export class Mem0Adapter {
  private config: Mem0Config
  private endpoint: string

  constructor(config: Mem0Config) {
    this.config = config
    this.endpoint = config.endpoint ?? DEFAULT_ENDPOINT
  }

  async add(input: AddMemoryInput): Promise<Memory> {
    if (!this.config.enabled) {
      throw new Error("Mem0 is not enabled")
    }

    const response = await this.request("/memories", {
      method: "POST",
      body: JSON.stringify({
        messages: [{ role: "user", content: input.content }],
        user_id: this.getUserId(input.layer),
        metadata: {
          ...input.metadata,
          layer: input.layer,
        },
      }),
    })

    const data = await response.json()
    return this.parseMemory(data, input.layer)
  }

  async search(input: SearchMemoryInput): Promise<MemorySearchResult[]> {
    if (!this.config.enabled) {
      throw new Error("Mem0 is not enabled")
    }

    const layers = this.normalizeLayers(input.layer)
    const results: MemorySearchResult[] = []

    for (const layer of layers) {
      const response = await this.request("/memories/search", {
        method: "POST",
        body: JSON.stringify({
          query: input.query,
          user_id: this.getUserId(layer),
          limit: input.limit ?? 10,
        }),
      })

      const data = await response.json()
      const layerResults = this.parseSearchResults(data, layer)
      results.push(...layerResults)
    }

    return results
      .filter((r) => !input.threshold || r.score >= input.threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, input.limit ?? 10)
  }

  async get(id: string): Promise<Memory | null> {
    if (!this.config.enabled) {
      throw new Error("Mem0 is not enabled")
    }

    try {
      const response = await this.request(`/memories/${id}`, {
        method: "GET",
      })

      const data = (await response.json()) as Record<string, unknown>
      const metadata = data.metadata as Record<string, unknown> | undefined
      return this.parseMemory(data, (metadata?.layer as MemoryLayer) ?? "user")
    } catch {
      return null
    }
  }

  async update(input: UpdateMemoryInput): Promise<Memory> {
    if (!this.config.enabled) {
      throw new Error("Mem0 is not enabled")
    }

    const existing = await this.get(input.id)
    if (!existing) {
      throw new Error(`Memory not found: ${input.id}`)
    }

    const response = await this.request(`/memories/${input.id}`, {
      method: "PUT",
      body: JSON.stringify({
        text: input.content ?? existing.content,
        metadata: input.metadata
          ? { ...existing.metadata, ...input.metadata }
          : existing.metadata,
      }),
    })

    const data = await response.json()
    return this.parseMemory(data, existing.layer)
  }

  async delete(id: string): Promise<void> {
    if (!this.config.enabled) {
      throw new Error("Mem0 is not enabled")
    }

    await this.request(`/memories/${id}`, {
      method: "DELETE",
    })
  }

  async getAll(layer?: MemoryLayer): Promise<Memory[]> {
    if (!this.config.enabled) {
      throw new Error("Mem0 is not enabled")
    }

    const layers = layer ? [layer] : this.getAllLayers()
    const memories: Memory[] = []

    for (const l of layers) {
      const response = await this.request("/memories", {
        method: "GET",
        params: { user_id: this.getUserId(l) },
      })

      const data = await response.json()
      const layerMemories = Array.isArray(data)
        ? data.map((m: unknown) => this.parseMemory(m, l))
        : []
      memories.push(...layerMemories)
    }

    return memories
  }

  async getStats(): Promise<MemoryStats> {
    const memories = await this.getAll()
    const byLayer: Record<MemoryLayer, number> = {
      user: 0,
      session: 0,
      project: 0,
      org: 0,
      company: 0,
    }

    for (const memory of memories) {
      byLayer[memory.layer]++
    }

    return {
      totalMemories: memories.length,
      byLayer,
    }
  }

  private async request(
    path: string,
    options: {
      method: string
      body?: string
      params?: Record<string, string>
    }
  ): Promise<Response> {
    if (!this.config.apiKey) {
      throw new Error("Mem0 API key is required")
    }

    let url = `${this.endpoint}${path}`
    if (options.params) {
      const searchParams = new URLSearchParams(options.params)
      url += `?${searchParams.toString()}`
    }

    const response = await fetch(url, {
      method: options.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${this.config.apiKey}`,
      },
      body: options.body,
    })

    if (!response.ok) {
      throw new Error(`Mem0 API error: ${response.status} ${response.statusText}`)
    }

    return response
  }

  private getUserId(layer: MemoryLayer): string {
    switch (layer) {
      case "user":
        return this.config.userId ?? "default-user"
      case "session":
        return `session-${this.config.userId ?? "default"}`
      case "project":
        return this.config.projectId ?? "default-project"
      case "org":
        return this.config.orgId ?? "default-org"
      case "company":
        return this.config.companyId ?? "default-company"
    }
  }

  private normalizeLayers(layer?: MemoryLayer | MemoryLayer[]): MemoryLayer[] {
    if (!layer) return this.getAllLayers()
    return Array.isArray(layer) ? layer : [layer]
  }

  private getAllLayers(): MemoryLayer[] {
    return ["user", "session", "project", "org", "company"]
  }

  private parseMemory(data: unknown, layer: MemoryLayer): Memory {
    const obj = data as Record<string, unknown>
    return {
      id: String(obj.id ?? obj.memory_id ?? ""),
      content: String(obj.memory ?? obj.text ?? obj.content ?? ""),
      layer,
      metadata: obj.metadata as Record<string, unknown> | undefined,
      createdAt: String(obj.created_at ?? new Date().toISOString()),
      updatedAt: obj.updated_at ? String(obj.updated_at) : undefined,
    }
  }

  private parseSearchResults(
    data: unknown,
    layer: MemoryLayer
  ): MemorySearchResult[] {
    const arr = Array.isArray(data) ? data : []
    return arr.map((item: unknown) => {
      const obj = item as Record<string, unknown>
      return {
        memory: this.parseMemory(obj, layer),
        score: Number(obj.score ?? obj.similarity ?? 1),
      }
    })
  }
}
