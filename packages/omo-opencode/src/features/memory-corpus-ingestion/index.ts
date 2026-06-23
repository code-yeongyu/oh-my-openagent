export { IngestionPipeline } from "./ingestion-pipeline"
export type { BatchEmbedder } from "./ingestion-pipeline"
export { InMemoryDedupStore } from "./dedup-store"
export { chunkText } from "./text-chunker"
export { parseEpub } from "./epub-parser"
export { computeSHA256, DEFAULT_INGESTION_CONFIG } from "./types"
export type { DedupEntry, DedupStore } from "./dedup-store"
export type { TextSection } from "./text-chunker"
export type {
  DocumentChunk,
  DocumentRecord,
  IngestionConfig,
  IngestionResult,
  IngestionStatus,
} from "./types"
