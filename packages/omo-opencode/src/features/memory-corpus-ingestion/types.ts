import { createHash } from "node:crypto"
import type { VespaDocument } from "../memory-vespa-client"

export type IngestionStatus =
  | "pending"
  | "parsing"
  | "chunking"
  | "embedding"
  | "feeding"
  | "complete"
  | "failed"

export interface DocumentRecord {
  doc_id: string
  source_file: string
  content_sha256: string
  document_title?: string
  document_type?: string
  chunk_count?: number
  status: IngestionStatus
  error?: string
  created_at: string
  updated_at: string
}

export interface DocumentChunk {
  doc_id: string
  chunk_index: number
  chunk_text: string
  chunk_tokens: number
  page_range?: string
  section_heading?: string
  source_file: string
  content_sha256: string
  document_title?: string
}

export interface IngestionResult {
  doc_id: string
  source_file: string
  content_sha256: string
  chunk_count: number
  chunks_indexed: number
  status: IngestionStatus
  duration_ms: number
  document_title?: string
  document_type?: string
  source_url?: string
  indexed_targets?: string[]
  error?: string
}

export interface PreparedIngestionDocument {
  doc_id: string
  source_file: string
  content_sha256: string
  chunk_count: number
  document_title?: string
  document_type?: string
  source_url?: string
  chunks: DocumentChunk[]
  documents: VespaDocument[]
}

export interface IngestionConfig {
  maxChunkTokens?: number
  chunkOverlap?: number
  embeddingDimensions?: number
  batchSize?: number
}

export function computeSHA256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex")
}

export const DEFAULT_INGESTION_CONFIG: Required<IngestionConfig> = {
  maxChunkTokens: 512,
  chunkOverlap: 64,
  embeddingDimensions: 1024,
  batchSize: 10,
}
