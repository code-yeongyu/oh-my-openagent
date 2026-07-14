export type SearchSource = "memory" | "compartment" | "commit" | "message" | "note"

export interface SearchQuery {
  text: string
  sessionId: string
  projectPath: string
  sources?: SearchSource[]
  limit?: number
  semanticOnly?: boolean
  useFts?: boolean
  threshold?: number
}

export interface SearchResult {
  id: string
  source: SearchSource
  title: string
  content: string
  score: number
  metadata?: Record<string, unknown>
}
