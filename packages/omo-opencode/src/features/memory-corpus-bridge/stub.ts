import type { L3Provider, L3ProviderCapabilities, L3RetrievalResult } from "./types"

export class L3StubProvider implements L3Provider {
  readonly providerName = "stub"
  readonly capabilities: L3ProviderCapabilities = {
    hybrid_search: false,
    reranking: false,
    long_document_reasoning: false,
    batch_search: false,
  }

  async isAvailable(): Promise<boolean> {
    return false
  }

  async search(_query: string, _limit?: number): Promise<L3RetrievalResult[]> {
    return []
  }

  async getDocument(_source_document: string): Promise<string | undefined> {
    return undefined
  }
}
