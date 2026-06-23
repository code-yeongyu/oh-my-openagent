import { VespaHttpClient } from "../memory-vespa-client"
import type { VespaClientConfig } from "../memory-vespa-client"
import type { PreparedIngestionDocument } from "../memory-corpus-ingestion/types"
import type { L3Provider, L3ProviderCapabilities, L3RetrievalResult } from "./types"

export interface VespaL3ProviderConfig {
  vespaConfig: VespaClientConfig
  projectFilter?: string
  defaultHits?: number
}

const EMBEDDING_DIMENSION = 1024

export class VespaL3Provider implements L3Provider {
  readonly providerName = "vespa"
  readonly capabilities: L3ProviderCapabilities = {
    hybrid_search: true,
    reranking: true,
    long_document_reasoning: false,
    batch_search: false,
  }

  private readonly client: VespaHttpClient
  private readonly config: Required<VespaL3ProviderConfig>

  constructor(config: VespaL3ProviderConfig) {
    this.config = {
      vespaConfig: config.vespaConfig,
      projectFilter: config.projectFilter ?? "",
      defaultHits: config.defaultHits ?? 10,
    }
    this.client = new VespaHttpClient(config.vespaConfig)
  }

  async isAvailable(): Promise<boolean> {
    try {
      return await this.client.isAvailable()
    } catch {
      return false
    }
  }

  async search(query: string, limit?: number): Promise<L3RetrievalResult[]> {
    const hits = limit ?? this.config.defaultHits
    try {
      const dummyEmbedding = new Array<number>(EMBEDDING_DIMENSION).fill(0)
      const response = await this.client.search(query, dummyEmbedding, {
        ranking: "default",
        hits,
      })
      return response.hits.map(hit => ({
        chunk_id: hit.id,
        source_document: hit.fields.source_file ?? "",
        content: hit.fields.chunk_text ?? "",
        score: hit.relevance,
        embedding_model: "gemini-embedding-001",
        retrieved_at: new Date().toISOString(),
      }))
    } catch {
      return []
    }
  }

  async searchHybrid(query: string, embedding: number[], limit?: number): Promise<L3RetrievalResult[]> {
    const hits = limit ?? this.config.defaultHits
    try {
      const response = await this.client.search(query, embedding, {
        ranking: "hybrid",
        hits,
      })
      return response.hits.map(hit => ({
        chunk_id: hit.id,
        source_document: hit.fields.source_file ?? "",
        content: hit.fields.chunk_text ?? "",
        score: hit.relevance,
        embedding_model: "gemini-embedding-001",
        retrieved_at: new Date().toISOString(),
      }))
    } catch {
      return []
    }
  }

  async getDocument(source_document: string): Promise<string | undefined> {
    try {
      const doc = await this.client.getDocument(source_document)
      return doc?.chunk_text
    } catch {
      return undefined
    }
  }

  async indexDocument(document: PreparedIngestionDocument): Promise<number> {
    let indexedCount = 0

    for (const chunkDocument of document.documents) {
      try {
        await this.client.feed(chunkDocument)
        indexedCount += 1
      } catch {
        continue
      }
    }

    return indexedCount
  }
}
