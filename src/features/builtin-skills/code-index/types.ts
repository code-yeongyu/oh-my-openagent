export type CodeIndexSubcommand =
  | "search"
  | "similar"
  | "index"
  | "status"
  | "symbols"
  | "references"
  | "dependencies"
  | "explain"

export type IndexLanguage =
  | "typescript"
  | "javascript"
  | "python"
  | "rust"
  | "go"
  | "java"
  | "kotlin"
  | "csharp"
  | "cpp"
  | "c"
  | "ruby"
  | "php"
  | "swift"
  | "scala"

export interface SearchInput {
  query: string
  semantic?: boolean
  language?: IndexLanguage
  paths?: string[]
  limit?: number
}

export interface SearchResult {
  filePath: string
  line: number
  column: number
  snippet: string
  score: number
  symbolName?: string
  symbolKind?: SymbolKind
}

export type SymbolKind =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "type"
  | "variable"
  | "constant"
  | "enum"
  | "module"
  | "namespace"

export interface SimilarInput {
  filePath: string
  line?: number
  symbolName?: string
  limit?: number
}

export interface SimilarResult {
  filePath: string
  symbolName: string
  symbolKind: SymbolKind
  similarity: number
  snippet: string
}

export interface IndexInput {
  paths?: string[]
  languages?: IndexLanguage[]
  force?: boolean
}

export interface IndexStatus {
  indexed: boolean
  lastIndexedAt?: string
  fileCount: number
  symbolCount: number
  languages: IndexLanguage[]
  vectorDbStatus: "connected" | "disconnected" | "indexing"
}

export interface SymbolInfo {
  name: string
  kind: SymbolKind
  filePath: string
  line: number
  column: number
  signature?: string
  documentation?: string
  references: number
}

export interface DependencyInfo {
  name: string
  version?: string
  usedBy: string[]
  imports: string[]
}

export interface ExplainInput {
  filePath: string
  line?: number
  symbolName?: string
}

export interface ExplainResult {
  summary: string
  purpose: string
  inputs?: ParameterInfo[]
  outputs?: string
  sideEffects?: string[]
  relatedSymbols: string[]
  usageExamples?: string[]
}

export interface ParameterInfo {
  name: string
  type: string
  description?: string
  optional?: boolean
}

export interface CodeIndexConfig {
  qdrant?: {
    url: string
    apiKey?: string
    collectionName?: string
  }
  chroma?: {
    url?: string
    collectionName?: string
  }
  embeddingModel?: string
  excludePaths?: string[]
  includeTests?: boolean
}
