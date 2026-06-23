import type { L3Provider, L3RetrievalResult } from "./types"
import type { PreparedIngestionDocument } from "../memory-corpus-ingestion/types"

export type L3QueryType = "factual" | "reasoning" | "document"

export interface L3IndexingProvider extends L3Provider {
  indexDocument?(document: PreparedIngestionDocument): Promise<number>
}

export interface L3RouterConfig {
  vespaProvider: L3IndexingProvider
  pageIndexProvider: L3IndexingProvider
}

const REASONING_KEYWORDS = [
  "explain", "why", "how does", "what is the relationship",
  "compare", "analyze", "summarize the entire", "across the whole",
  "throughout the document", "what does chapter", "what does section",
  "multi-hop", "reason", "understand",
]

const DOCUMENT_KEYWORDS = [
  "in this paper", "in this book", "in this report", "in this document",
  "the authors say", "according to the document", "the paper claims",
  "in section", "in chapter", "on page",
]

export function classifyQuery(query: string): L3QueryType {
  const lower = query.toLowerCase()
  const isDocument = DOCUMENT_KEYWORDS.some(kw => lower.includes(kw))
  if (isDocument) return "document"
  const isReasoning = REASONING_KEYWORDS.some(kw => lower.includes(kw))
  if (isReasoning) return "reasoning"
  return "factual"
}

export class L3Router {
  constructor(private readonly config: L3RouterConfig) {}

  async search(query: string, limit?: number): Promise<L3RetrievalResult[]> {
    const queryType = classifyQuery(query)
    const vespaAvailable = await this.config.vespaProvider.isAvailable()
    const pageIndexAvailable = await this.config.pageIndexProvider.isAvailable()

    if (queryType === "reasoning" || queryType === "document") {
      if (pageIndexAvailable) {
        const results = await this.config.pageIndexProvider.search(query, limit)
        if (results.length > 0) return results
      }
      if (vespaAvailable) return this.config.vespaProvider.search(query, limit)
    } else {
      if (vespaAvailable) return this.config.vespaProvider.search(query, limit)
      if (pageIndexAvailable) return this.config.pageIndexProvider.search(query, limit)
    }

    return []
  }

  async isAvailable(): Promise<boolean> {
    const [vespa, pageIndex] = await Promise.all([
      this.config.vespaProvider.isAvailable(),
      this.config.pageIndexProvider.isAvailable(),
    ])
    return vespa || pageIndex
  }

  async indexDocument(
    document: PreparedIngestionDocument,
  ): Promise<{ indexedCount: number; indexedTargets: string[] }> {
    const indexedTargets: string[] = []
    let indexedCount = 0

    if (await this.config.pageIndexProvider.isAvailable()) {
      const providerIndexedCount = await this.config.pageIndexProvider.indexDocument?.(document)
      if ((providerIndexedCount ?? 0) > 0) {
        indexedTargets.push(this.config.pageIndexProvider.providerName)
        indexedCount += providerIndexedCount ?? 0
      }
    }

    if (await this.config.vespaProvider.isAvailable()) {
      const providerIndexedCount = await this.config.vespaProvider.indexDocument?.(document)
      if ((providerIndexedCount ?? 0) > 0) {
        indexedTargets.push(this.config.vespaProvider.providerName)
        indexedCount += providerIndexedCount ?? 0
      }
    }

    if (indexedTargets.length === 0) {
      throw new Error("No L3 provider accepted the prepared document for indexing")
    }

    return { indexedCount, indexedTargets }
  }

  async searchDocument(source_document: string): Promise<string | undefined> {
    const pageIndexAvailable = await this.config.pageIndexProvider.isAvailable()
    if (pageIndexAvailable) {
      const content = await this.config.pageIndexProvider.getDocument(source_document)
      if (content) return content
    }
    return this.config.vespaProvider.getDocument(source_document)
  }
}
