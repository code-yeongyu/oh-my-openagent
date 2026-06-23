export interface L3RetrievalResult {
  chunk_id: string
  source_document: string
  content: string
  score: number
  embedding_model?: string
  retrieved_at: string
}

export type L3PromotionType = "discovery" | "benchmark" | "rule" | "convention"

export interface L3ToL2PromotionRequest {
  retrieval_result: L3RetrievalResult
  distilled_summary: string
  why_it_matters: string
  source_refs: Record<string, string>
  proposed_type: L3PromotionType
  confidence: number
}

export interface L3ProviderCapabilities {
  hybrid_search: boolean
  reranking: boolean
  long_document_reasoning: boolean
  batch_search: boolean
}

export interface L3Provider {
  readonly providerName: string
  readonly capabilities: L3ProviderCapabilities

  isAvailable(): Promise<boolean>
  search(query: string, limit?: number): Promise<L3RetrievalResult[]>
  getDocument(source_document: string): Promise<string | undefined>
}
