/// <reference path="./bun-test.d.ts" />

import { describe, expect, it, mock } from "bun:test"
import { InMemoryDedupStore } from "./dedup-store"
import { IngestionPipeline } from "./ingestion-pipeline"
import { chunkText } from "./text-chunker"
import { computeSHA256 } from "./types"
import type { TextSection } from "./text-chunker"

const makeWords = (count: number, prefix = "word") =>
  Array.from({ length: count }, (_, index) => `${prefix}-${index}`).join(" ")

const makeEmbedder = (dim = 1024) => ({
  embed: mock(async (_text: string) => ({ embedding: new Array<number>(dim).fill(0.1) })),
  batchEmbed: mock(async (texts: string[]) => ({
    embeddings: texts.map(() => new Array<number>(dim).fill(0.1)),
  })),
})

const makeVespa = () => ({
  feed: mock(async (_doc: unknown) => ({ id: "test", pathId: "/test" })),
  isAvailable: mock(async () => true),
})

describe("memory-corpus-ingestion", () => {
  describe("#given computeSHA256", () => {
    describe("#when content is identical", () => {
      it("#then returns the same hash", () => {
        expect(computeSHA256("same-content")).toBe(computeSHA256("same-content"))
      })
    })
  })

  describe("#given chunkText", () => {
    describe("#when text exceeds chunk size", () => {
      it("#then splits into overlapped chunks", () => {
        const chunks = chunkText(
          [{ text: makeWords(25) }],
          "doc-1",
          "book.pdf",
          "sha-1",
          { maxChunkTokens: 10, chunkOverlap: 2, embeddingDimensions: 1024, batchSize: 10 },
          "Book"
        )

        expect(chunks).toHaveLength(3)
        expect(chunks.map((chunk) => chunk.chunk_tokens)).toEqual([10, 10, 9])
        expect(chunks[0]?.chunk_text.split(/\s+/).slice(-2)).toEqual(["word-8", "word-9"])
        expect(chunks[1]?.chunk_text.split(/\s+/).slice(0, 2)).toEqual(["word-8", "word-9"])
        expect(chunks[1]?.chunk_index).toBe(1)
      })
    })

    describe("#when multiple sections are provided", () => {
      it("#then preserves section boundaries", () => {
        const sections: TextSection[] = [
          { heading: "Intro", page_range: "1-2", text: makeWords(12, "intro") },
          { heading: "Body", page_range: "3-4", text: makeWords(12, "body") },
        ]

        const chunks = chunkText(
          sections,
          "doc-2",
          "paper.pdf",
          "sha-2",
          { maxChunkTokens: 10, chunkOverlap: 2, embeddingDimensions: 1024, batchSize: 10 },
          "Paper"
        )

        expect(chunks).toHaveLength(2)
        expect(chunks[0]?.section_heading).toBe("Intro")
        expect(chunks[0]?.page_range).toBe("1-2")
        expect(chunks[0]?.chunk_text).toContain("intro-0")
        expect(chunks[0]?.chunk_text).not.toContain("body-0")
        expect(chunks[1]?.section_heading).toBe("Body")
        expect(chunks[1]?.page_range).toBe("3-4")
        expect(chunks[1]?.chunk_text).toContain("body-0")
      })
    })
  })

  describe("#given InMemoryDedupStore", () => {
    describe("#when an entry is recorded", () => {
      it("#then has returns true after being false initially", async () => {
        const store = new InMemoryDedupStore()
        expect(await store.has("sha-1")).toBe(false)

        await store.record({
          content_sha256: "sha-1",
          doc_id: "doc-1",
          source_file: "book.pdf",
          ingested_at: "2026-04-12T00:00:00.000Z",
        })

        expect(await store.has("sha-1")).toBe(true)
      })
    })
  })

  describe("#given IngestionPipeline", () => {
    describe("#when the same content hash already exists", () => {
      it("#then skips re-ingestion before embedding or feeding", async () => {
        const dedupStore = new InMemoryDedupStore()
        const sections: TextSection[] = [{ text: makeWords(15) }]
        const fullText = sections.map((section) => section.text).join("\n\n")
        const contentSha256 = computeSHA256(fullText)
        await dedupStore.record({
          content_sha256: contentSha256,
          doc_id: `doc_${contentSha256.slice(0, 16)}`,
          source_file: "existing.pdf",
          ingested_at: "2026-04-12T00:00:00.000Z",
        })

        const embedder = makeEmbedder()
        const vespa = makeVespa()
        const pipeline = new IngestionPipeline({ embedder, vespa, dedupStore })

        const result = await pipeline.ingest("existing.pdf", sections)

        expect(result.status).toBe("complete")
        expect(result.chunks_indexed).toBe(0)
        expect(embedder.batchEmbed).not.toHaveBeenCalled()
        expect(vespa.feed).not.toHaveBeenCalled()
      })
    })

    describe("#when chunks span multiple batches", () => {
      it("#then calls embedder.batchEmbed for each batch", async () => {
        const embedder = makeEmbedder()
        const vespa = makeVespa()
        const pipeline = new IngestionPipeline(
          { embedder, vespa, dedupStore: new InMemoryDedupStore() },
          { maxChunkTokens: 10, chunkOverlap: 2, embeddingDimensions: 1024, batchSize: 2 }
        )

        const result = await pipeline.ingest("batched.pdf", [{ text: makeWords(30) }])

        expect(result.status).toBe("complete")
        expect(result.chunks_indexed).toBe(4)
        expect(embedder.batchEmbed).toHaveBeenCalledTimes(2)
      })
    })

    describe("#when ingestion succeeds", () => {
      it("#then feeds Vespa once per chunk and returns complete status", async () => {
        const embedder = makeEmbedder()
        const vespa = makeVespa()
        const pipeline = new IngestionPipeline(
          { embedder, vespa, dedupStore: new InMemoryDedupStore() },
          { maxChunkTokens: 10, chunkOverlap: 2, embeddingDimensions: 1024, batchSize: 10 }
        )

        const result = await pipeline.ingest("guide.pdf", [{ text: makeWords(25) }], {
          documentTitle: "Guide",
          documentType: "paper",
        })

        expect(result.status).toBe("complete")
        expect(result.chunks_indexed).toBe(3)
        expect(vespa.feed).toHaveBeenCalledTimes(3)
      })
    })

    describe("#when no chunks are produced", () => {
      it("#then returns failed status", async () => {
        const embedder = makeEmbedder()
        const vespa = makeVespa()
        const pipeline = new IngestionPipeline({
          embedder,
          vespa,
          dedupStore: new InMemoryDedupStore(),
        })

        const result = await pipeline.ingest("empty.pdf", [{ text: "too short" }])

        expect(result.status).toBe("failed")
        expect(result.error).toBe("No chunks produced from document")
      })
    })
  })
})
