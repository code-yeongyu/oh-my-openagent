import type { L3Provider, L3ProviderCapabilities, L3RetrievalResult } from "./types"
import type { PreparedIngestionDocument } from "../memory-corpus-ingestion/types"

export interface PageIndexAdapterConfig {
  baseUrl: string
  timeoutMs?: number
}

export class PageIndexAdapterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PageIndexAdapterError"
  }
}

const HEALTH_TIMEOUT_MS = 3_000
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_TOP_K = 5

interface PageIndexSearchResult {
  node_id: string
  title: string
  content: string
  score: number
  source_doc: string
}

export class PageIndexAdapter implements L3Provider {
  readonly providerName = "pageindex"
  readonly capabilities: L3ProviderCapabilities = {
    hybrid_search: false,
    reranking: false,
    long_document_reasoning: true,
    batch_search: false,
  }

  private readonly config: Required<PageIndexAdapterConfig>

  constructor(config: PageIndexAdapterConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/$/, ""),
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)
      try {
        const res = await globalThis.fetch(`${this.config.baseUrl}/health`, {
          signal: controller.signal,
        })
        return res.ok
      } finally {
        clearTimeout(timer)
      }
    } catch {
      return false
    }
  }

  async search(query: string, limit?: number): Promise<L3RetrievalResult[]> {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)
      try {
        const res = await globalThis.fetch(`${this.config.baseUrl}/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, top_k: limit ?? DEFAULT_TOP_K }),
          signal: controller.signal,
        })
        if (!res.ok) return []
        const raw = (await res.json()) as { results?: PageIndexSearchResult[] }
        return (raw.results ?? []).map(r => ({
          chunk_id: r.node_id,
          source_document: r.source_doc,
          content: r.content,
          score: r.score,
          retrieved_at: new Date().toISOString(),
        }))
      } finally {
        clearTimeout(timer)
      }
    } catch {
      return []
    }
  }

  async getDocument(source_document: string): Promise<string | undefined> {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)
      try {
        const res = await globalThis.fetch(
          `${this.config.baseUrl}/document/${encodeURIComponent(source_document)}`,
          { signal: controller.signal },
        )
        if (!res.ok) return undefined
        const raw = (await res.json()) as { content?: string }
        return raw.content
      } finally {
        clearTimeout(timer)
      }
    } catch {
      return undefined
    }
  }

  async indexDocument(_document: PreparedIngestionDocument): Promise<number> {
    return 0
  }
}
