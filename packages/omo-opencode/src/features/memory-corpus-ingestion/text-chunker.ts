import type { DocumentChunk, IngestionConfig } from "./types"
import { DEFAULT_INGESTION_CONFIG } from "./types"

export interface TextSection {
  heading?: string
  text: string
  page_range?: string
}

export function chunkText(
  sections: TextSection[],
  docId: string,
  sourceFile: string,
  contentSha256: string,
  config: Required<IngestionConfig> = DEFAULT_INGESTION_CONFIG,
  documentTitle?: string
): DocumentChunk[] {
  const chunks: DocumentChunk[] = []
  let chunkIndex = 0

  for (const section of sections) {
    const text = section.text.trim()
    if (!text) {
      continue
    }

    const words = text.split(/\s+/)
    if (words.length === 0) {
      continue
    }

    const wordsPerChunk = config.maxChunkTokens
    const overlapWords = config.chunkOverlap
    const step = Math.max(1, wordsPerChunk - overlapWords)
    const minChunkWords = 5

    for (let i = 0; i < words.length; i += step) {
      const slice = words.slice(i, i + wordsPerChunk)
      if (slice.length < minChunkWords) {
        break
      }

      chunks.push({
        doc_id: docId,
        chunk_index: chunkIndex,
        chunk_text: slice.join(" "),
        chunk_tokens: slice.length,
        page_range: section.page_range,
        section_heading: section.heading,
        source_file: sourceFile,
        content_sha256: contentSha256,
        document_title: documentTitle,
      })
      chunkIndex += 1
    }
  }

  return chunks
}
