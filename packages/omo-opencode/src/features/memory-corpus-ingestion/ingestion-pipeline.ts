import type { VespaDocument, VespaHttpClient } from "../memory-vespa-client"
import type { DedupStore } from "./dedup-store"
import { chunkText } from "./text-chunker"
import type { TextSection } from "./text-chunker"
import type {
  IngestionConfig,
  IngestionResult,
  PreparedIngestionDocument,
} from "./types"
import { DEFAULT_INGESTION_CONFIG, computeSHA256 } from "./types"

export interface BatchEmbedder {
  batchEmbed(
    texts: string[],
    taskType?: string,
  ): Promise<{ embeddings: number[][] }>
}

type EmbeddingClient = BatchEmbedder
type VespaClient = Pick<VespaHttpClient, "feed">

export interface L3DocumentIndexer {
  indexDocument(
    document: PreparedIngestionDocument,
  ): Promise<{ indexedCount: number; indexedTargets: string[] }>
}

export interface IngestionPipelineDeps {
  embedder: EmbeddingClient
  vespa: VespaClient
  dedupStore: DedupStore
  l3Indexer?: L3DocumentIndexer
}

export class IngestionPipeline {
  private readonly config: Required<IngestionConfig>

  constructor(
    private readonly deps: IngestionPipelineDeps,
    config: IngestionConfig = {}
  ) {
    this.config = { ...DEFAULT_INGESTION_CONFIG, ...config }
  }

  async ingest(
    sourceFile: string,
    sections: TextSection[],
    options: {
      documentTitle?: string
      documentType?: string
      sourceUrl?: string
      forceReindex?: boolean
    } = {}
  ): Promise<IngestionResult> {
    const start = Date.now()
    const fullText = sections.map((section) => section.text).join("\n\n")
    const contentSha256 = computeSHA256(fullText)
    const docId = `doc_${contentSha256.slice(0, 16)}`

    try {
      if (!options.forceReindex) {
        const existing = await this.deps.dedupStore.getByHash(contentSha256)
        if (existing) {
          return {
            doc_id: docId,
            source_file: sourceFile,
            content_sha256: contentSha256,
            chunk_count: 0,
            chunks_indexed: 0,
            status: "complete",
            duration_ms: Date.now() - start,
            document_title: options.documentTitle,
            document_type: options.documentType,
            source_url: options.sourceUrl,
            indexed_targets: [],
          }
        }
      }

      const preparedDocument = await this.prepareDocument(sourceFile, sections, options)
      const { indexedCount, indexedTargets } = await this.indexPreparedDocument(preparedDocument)

      await this.deps.dedupStore.record({
        content_sha256: contentSha256,
        doc_id: docId,
        source_file: sourceFile,
        ingested_at: new Date().toISOString(),
      })

      return {
        doc_id: docId,
        source_file: sourceFile,
        content_sha256: contentSha256,
        chunk_count: preparedDocument.chunk_count,
        chunks_indexed: indexedCount,
        status: "complete",
        duration_ms: Date.now() - start,
        document_title: preparedDocument.document_title,
        document_type: preparedDocument.document_type,
        source_url: preparedDocument.source_url,
        indexed_targets: indexedTargets,
      }
    } catch (error) {
      return this.createFailedResult(
        start,
        docId,
        sourceFile,
        contentSha256,
        error instanceof Error ? error.message : "Document ingestion failed"
      )
    }
  }

  async prepareDocument(
    sourceFile: string,
    sections: TextSection[],
    options: {
      documentTitle?: string
      documentType?: string
      sourceUrl?: string
    } = {},
  ): Promise<PreparedIngestionDocument> {
    const fullText = sections.map((section) => section.text).join("\n\n")
    const contentSha256 = computeSHA256(fullText)
    const docId = `doc_${contentSha256.slice(0, 16)}`
    const chunks = chunkText(
      sections,
      docId,
      sourceFile,
      contentSha256,
      this.config,
      options.documentTitle,
    )

    if (chunks.length === 0) {
      throw new Error("No chunks produced from document")
    }

    const documents: VespaDocument[] = []
    for (let i = 0; i < chunks.length; i += this.config.batchSize) {
      const batch = chunks.slice(i, i + this.config.batchSize)
      const texts = batch.map((chunk) => chunk.chunk_text)
      const { embeddings } = await this.deps.embedder.batchEmbed(texts)

      for (const [index, chunk] of batch.entries()) {
        const embedding = embeddings[index]
        if (!embedding || embedding.length === 0) {
          continue
        }

        documents.push({
          doc_id: chunk.doc_id,
          chunk_index: chunk.chunk_index,
          source_file: chunk.source_file,
          source_sha256: chunk.content_sha256,
          chunk_text: chunk.chunk_text,
          chunk_tokens: chunk.chunk_tokens,
          embedding,
          document_title: chunk.document_title,
          document_type: options.documentType,
          page_range: chunk.page_range,
          section_heading: chunk.section_heading,
          ingested_at: new Date().toISOString(),
        })
      }
    }

    return {
      doc_id: docId,
      source_file: sourceFile,
      content_sha256: contentSha256,
      chunk_count: chunks.length,
      document_title: options.documentTitle,
      document_type: options.documentType,
      source_url: options.sourceUrl,
      chunks,
      documents,
    }
  }

  private async indexPreparedDocument(
    document: PreparedIngestionDocument,
  ): Promise<{ indexedCount: number; indexedTargets: string[] }> {
    if (this.deps.l3Indexer) {
      return this.deps.l3Indexer.indexDocument(document)
    }

    let indexedCount = 0
    for (const vespaDocument of document.documents) {
      try {
        await this.deps.vespa.feed(vespaDocument)
        indexedCount += 1
      } catch {
        continue
      }
    }

    return {
      indexedCount,
      indexedTargets: indexedCount > 0 ? ["vespa"] : [],
    }
  }

  private createFailedResult(
    start: number,
    docId: string,
    sourceFile: string,
    contentSha256: string,
    error: string
  ): IngestionResult {
    return {
      doc_id: docId,
      source_file: sourceFile,
      content_sha256: contentSha256,
      chunk_count: 0,
      chunks_indexed: 0,
      status: "failed",
      duration_ms: Date.now() - start,
      error,
    }
  }
}
